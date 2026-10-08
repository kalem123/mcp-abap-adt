import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, getBaseUrl } from '../lib/utils';

interface CheckMessage {
    type: string;
    text: string;
    line: number | null;
    column: number | null;
    uri: string;
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

function parseMessages(xml: string): CheckMessage[] {
    const messages: CheckMessage[] = [];
    const blocks = xml.match(/<chkrun:checkMessage\b[\s\S]*?(?:\/>|<\/chkrun:checkMessage>)/gi) || [];
    for (const block of blocks) {
        const head = block.match(/<chkrun:checkMessage\b[^>]*>/i)?.[0] || '';
        const uri = attr(head, 'chkrun:uri');
        // uri looks like /sap/bc/adt/.../source/main#start=12,5
        const start = uri.match(/#start=(\d+)(?:,(\d+))?/);
        messages.push({
            type: attr(head, 'chkrun:type'),
            text: decodeXml(attr(head, 'chkrun:shortText')),
            line: start ? Number(start[1]) : null,
            column: start && start[2] ? Number(start[2]) : null,
            uri,
        });
    }
    return messages;
}

/**
 * Syntax check via ADT check runs. Without `source` the saved version of the object is checked;
 * with `source` the given (unsaved) code is checked against the object, nothing is written.
 */
export async function handleCheckSyntax(args: any) {
    try {
        const sourceUrl = args?.object_source_url ? String(args.object_source_url) : '';
        if (!sourceUrl.startsWith('/sap/bc/adt/')) {
            throw new McpError(ErrorCode.InvalidParams, 'object_source_url is required and must start with /sap/bc/adt/ (e.g. /sap/bc/adt/oo/classes/zcl_foo/source/main)');
        }

        const system = args?.sap_system || 'S4H';
        const version = args?.version === 'inactive' ? 'inactive' : 'active';

        let artifacts = '';
        if (args?.source !== undefined) {
            const encoded = Buffer.from(String(args.source), 'utf-8').toString('base64');
            artifacts =
                '<chkrun:artifacts>' +
                `<chkrun:artifact chkrun:contentType="text/plain; charset=utf-8" chkrun:uri="${sourceUrl}">` +
                `<chkrun:content>${encoded}</chkrun:content>` +
                '</chkrun:artifact>' +
                '</chkrun:artifacts>';
        }

        const body =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core">' +
            `<chkrun:checkObject adtcore:uri="${sourceUrl}" chkrun:version="${version}">${artifacts}</chkrun:checkObject>` +
            '</chkrun:checkObjectList>';

        const url = `${await getBaseUrl(system)}/sap/bc/adt/checkruns?reporters=abapCheckRun`;
        const response = await makeAdtRequest(url, 'POST', 60000, body, undefined, system, {
            'Content-Type': 'application/vnd.sap.adt.checkobjects+xml',
            'Accept': 'application/vnd.sap.adt.checkmessages+xml',
        });

        const xml = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        const messages = parseMessages(xml);

        // Unknown format: hand back the raw XML instead of a false "no errors".
        if (messages.length === 0 && /checkMessage/i.test(xml)) {
            return { content: [{ type: 'text', text: xml }] };
        }

        const errors = messages.filter((m) => m.type === 'E' || m.type === 'A' || m.type === 'X').length;
        const result = {
            object: sourceUrl,
            system: String(system).toUpperCase(),
            checked: args?.source !== undefined ? 'provided source (unsaved)' : `${version} version`,
            ok: errors === 0,
            errors,
            warnings: messages.filter((m) => m.type === 'W').length,
            messages,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
        return return_error(error);
    }
}
