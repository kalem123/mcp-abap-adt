import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, getBaseUrl } from '../lib/utils';

interface AtcFinding {
    priority: string;
    check: string;
    message: string;
    object: string;
    location: string;
    line: number | null;
}

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

function asText(data: any): string {
    return typeof data === 'string' ? data : JSON.stringify(data);
}

/** Walks objects and findings in document order so every finding knows its object. */
function parseFindings(xml: string): AtcFinding[] {
    const findings: AtcFinding[] = [];
    const tokens = xml.match(/<atcobject:object\b[^>]*>|<atcfinding:finding\b[^>]*>/gi) || [];
    let currentObject = '';
    for (const token of tokens) {
        if (/^<atcobject:object/i.test(token)) {
            currentObject = attr(token, 'adtcore:name');
            continue;
        }
        const location = attr(token, 'location');
        const line = location.match(/#start=(\d+)/);
        findings.push({
            priority: attr(token, 'priority'),
            check: decodeXml(attr(token, 'checkTitle')),
            message: decodeXml(attr(token, 'messageTitle')),
            object: currentObject,
            location,
            line: line ? Number(line[1]) : null,
        });
    }
    return findings;
}

/**
 * ATC check of one repository object: create worklist, start run, read findings.
 * Read-only for the object; the run itself is stored in the ATC result store of the system.
 */
export async function handleRunAtc(args: any) {
    try {
        const objectUrl = args?.object_url ? String(args.object_url) : '';
        if (!objectUrl.startsWith('/sap/bc/adt/')) {
            throw new McpError(ErrorCode.InvalidParams, 'object_url is required and must start with /sap/bc/adt/ (object, not source, e.g. /sap/bc/adt/oo/classes/zcl_foo)');
        }

        const system = args?.sap_system || 'S4H';
        const base = await getBaseUrl(system);
        const xmlHeaders = { 'Content-Type': 'application/xml', 'Accept': 'application/xml' };

        let variant = args?.check_variant ? String(args.check_variant) : '';
        if (!variant) {
            const customizing = await makeAdtRequest(`${base}/sap/bc/adt/atc/customizing`, 'GET', 30000, undefined, undefined, system, { 'Accept': 'application/xml' });
            const xml = asText(customizing.data);
            variant = xml.match(/(?:name|key)="systemCheckVariant"[^>]*value="([^"]*)"/i)?.[1]
                || xml.match(/value="([^"]*)"[^>]*(?:name|key)="systemCheckVariant"/i)?.[1]
                || '';
            if (!variant) {
                throw new McpError(ErrorCode.InvalidParams, `No check variant given and no system default found; pass check_variant. Customizing response: ${xml.slice(0, 1500)}`);
            }
        }

        const worklist = await makeAdtRequest(
            `${base}/sap/bc/adt/atc/worklists?checkVariant=${encodeURIComponent(variant)}`,
            'POST', 30000, undefined, undefined, system, { 'Accept': 'text/plain' }
        );
        const worklistId = asText(worklist.data).trim();
        if (!worklistId) {
            throw new Error('ATC did not return a worklist id');
        }

        const runBody =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<atc:run xmlns:atc="http://www.sap.com/adt/atc" maximumVerdicts="500">' +
            '<objectSets xmlns:adtcore="http://www.sap.com/adt/core"><objectSet kind="inclusive">' +
            `<adtcore:objectReferences><adtcore:objectReference adtcore:uri="${objectUrl}"/></adtcore:objectReferences>` +
            '</objectSet></objectSets></atc:run>';
        await makeAdtRequest(
            `${base}/sap/bc/adt/atc/runs?worklistId=${encodeURIComponent(worklistId)}`,
            'POST', 120000, runBody, undefined, system, xmlHeaders
        );

        const result = await makeAdtRequest(
            `${base}/sap/bc/adt/atc/worklists/${encodeURIComponent(worklistId)}?includeExemptedFindings=false`,
            'GET', 60000, undefined, undefined, system, { 'Accept': 'application/atc.worklist.v1+xml' }
        );
        const xml = asText(result.data);
        const findings = parseFindings(xml);

        // Unknown format: hand back the raw XML instead of a false "no findings".
        if (findings.length === 0 && /finding/i.test(xml.replace(/<[^>]*findings\s*\/>/gi, ''))) {
            return { content: [{ type: 'text', text: xml }] };
        }

        const maxResults = Number(args?.maxResults) > 0 ? Number(args.maxResults) : 200;
        const summary = {
            object: objectUrl,
            system: String(system).toUpperCase(),
            checkVariant: variant,
            worklistId,
            count: findings.length,
            byPriority: findings.reduce((acc: Record<string, number>, f) => {
                acc[f.priority || '?'] = (acc[f.priority || '?'] || 0) + 1;
                return acc;
            }, {}),
            truncated: findings.length > maxResults,
            findings: findings.slice(0, maxResults),
        };
        return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    } catch (error) {
        return return_error(error);
    }
}
