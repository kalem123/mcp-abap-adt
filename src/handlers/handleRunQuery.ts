import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, getBaseUrl } from '../lib/utils';

const DEFAULT_ROWS = 100;
const MAX_ROWS = 1000;

function attr(source: string, name: string): string {
    const match = source.match(new RegExp(`(?:^|[\\s:])${name}="([^"]*)"`));
    return match ? match[1] : '';
}

function decodeXml(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/** The data preview returns column-wise data; rebuild rows. */
function parseTable(xml: string): { columns: string[]; rows: Record<string, string>[]; totalRows: number | null } | null {
    const columnBlocks = xml.match(/<dataPreview:columns\b[\s\S]*?<\/dataPreview:columns>/gi) || [];
    if (columnBlocks.length === 0) {
        return null;
    }
    const names: string[] = [];
    const values: string[][] = [];
    for (const block of columnBlocks) {
        const meta = block.match(/<dataPreview:metadata\b[^>]*>/i)?.[0] || '';
        names.push(attr(meta, 'dataPreview:name'));
        const cells = block.match(/<dataPreview:data\b[^>]*?(?:\/>|>[\s\S]*?<\/dataPreview:data>)/gi) || [];
        values.push(cells.map((cell) => decodeXml(cell.replace(/^<dataPreview:data\b[^>]*?>/i, '').replace(/<\/dataPreview:data>$/i, '').replace(/^<dataPreview:data\b[^>]*\/>$/i, ''))));
    }
    const rowCount = Math.max(0, ...values.map((v) => v.length));
    const rows: Record<string, string>[] = [];
    for (let i = 0; i < rowCount; i++) {
        const row: Record<string, string> = {};
        names.forEach((name, c) => {
            // The endpoint pads values with trailing blanks (e.g. COUNT "269 "); they carry no meaning in ABAP.
            row[name] = (values[c][i] ?? '').trimEnd();
        });
        rows.push(row);
    }
    const total = xml.match(/<dataPreview:totalRows>(\d+)<\/dataPreview:totalRows>/i);
    return { columns: names, rows, totalRows: total ? Number(total[1]) : null };
}

/**
 * Runs a read-only open SQL SELECT through the ADT data preview (freestyle). Works for
 * database tables and CDS views; authorizations of the logged-on user apply.
 */
export async function handleRunQuery(args: any) {
    try {
        const sql = args?.sql ? String(args.sql).trim().replace(/;+\s*$/, '') : '';
        if (!sql) {
            throw new McpError(ErrorCode.InvalidParams, 'sql is required (a single SELECT statement)');
        }
        if (!/^(select|with)\b/i.test(sql)) {
            throw new McpError(ErrorCode.InvalidParams, 'Only SELECT statements are allowed');
        }
        if (sql.includes(';')) {
            throw new McpError(ErrorCode.InvalidParams, 'Only a single statement is allowed (no semicolons)');
        }

        const system = args?.sap_system || 'S4H';
        const requested = Number(args?.maxRows);
        const maxRows = Math.min(Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_ROWS, MAX_ROWS);

        const url = `${await getBaseUrl(system)}/sap/bc/adt/datapreview/freestyle?rowNumber=${maxRows}`;
        const response = await makeAdtRequest(url, 'POST', 60000, sql, undefined, system, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Accept': 'application/vnd.sap.adt.datapreview.table.v1+xml',
        });

        const xml = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        const table = parseTable(xml);

        // Unknown format: hand back the raw XML instead of an empty result.
        if (!table) {
            return { content: [{ type: 'text', text: xml }] };
        }

        const result = {
            system: String(system).toUpperCase(),
            rowCount: table.rows.length,
            totalRows: table.totalRows,
            truncated: table.rows.length >= maxRows,
            columns: table.columns,
            rows: table.rows,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
        return return_error(error);
    }
}
