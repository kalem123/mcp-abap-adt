import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, getBaseUrl } from '../lib/utils';

const REQUEST_BODY =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<usagereferences:usageReferenceRequest xmlns:usagereferences="http://www.sap.com/adt/ris/usageReferences">' +
    '<usagereferences:affectedObjects/>' +
    '</usagereferences:usageReferenceRequest>';

const OBJECT_PATHS: Record<string, (name: string) => string> = {
    class: (n) => `/sap/bc/adt/oo/classes/${n}`,
    interface: (n) => `/sap/bc/adt/oo/interfaces/${n}`,
    program: (n) => `/sap/bc/adt/programs/programs/${n}`,
    include: (n) => `/sap/bc/adt/programs/includes/${n}`,
    function_group: (n) => `/sap/bc/adt/functions/groups/${n}`,
    table: (n) => `/sap/bc/adt/ddic/tables/${n}`,
    structure: (n) => `/sap/bc/adt/ddic/structures/${n}`,
    data_element: (n) => `/sap/bc/adt/ddic/dataelements/${n}`,
    domain: (n) => `/sap/bc/adt/ddic/domains/${n}`,
    ddls: (n) => `/sap/bc/adt/ddic/ddl/sources/${n}`,
};

interface UsageReference {
    name: string;
    type: string;
    package: string;
    uri: string;
    parent: string;
    usage: string;
}

function attr(source: string, name: string): string {
    const match = source.match(new RegExp(`(?:^|[\\s:])${name}="([^"]*)"`));
    return match ? match[1] : '';
}

function parseReferences(xml: string): UsageReference[] {
    const references: UsageReference[] = [];
    const blocks = xml.match(/<usagereferences:referencedObject\b[\s\S]*?<\/usagereferences:referencedObject>/gi) || [];
    for (const block of blocks) {
        const head = block.match(/<usagereferences:referencedObject\b[^>]*>/i)?.[0] || '';
        // Real usages carry usageInformation (or isResult=true); the rest are structural parents (class, package).
        const usage = attr(head, 'usageInformation');
        if (attr(head, 'isResult') !== 'true' && !usage) {
            continue;
        }
        const adtObject = block.match(/<usagereferences:adtObject\b[^>]*>/i)?.[0] || '';
        const packageRef = block.match(/<adtcore:packageRef\b[^>]*>/)?.[0] || '';
        references.push({
            name: attr(adtObject, 'adtcore:name'),
            type: attr(adtObject, 'adtcore:type'),
            package: attr(packageRef, 'adtcore:name'),
            uri: attr(head, 'uri') || attr(adtObject, 'adtcore:uri'),
            parent: attr(head, 'parentUri'),
            usage,
        });
    }
    return references;
}

function resolveObjectPath(args: any): string {
    if (args?.object_url) {
        const url = String(args.object_url);
        if (!url.startsWith('/sap/bc/adt/')) {
            throw new McpError(ErrorCode.InvalidParams, 'object_url must start with /sap/bc/adt/');
        }
        return url;
    }

    if (!args?.object_name || !args?.object_type) {
        throw new McpError(ErrorCode.InvalidParams, 'Provide object_url, or object_name together with object_type');
    }

    const encodedName = encodeURIComponent(String(args.object_name).toLowerCase());

    if (args.object_type === 'function') {
        if (!args?.function_group) {
            throw new McpError(ErrorCode.InvalidParams, 'function_group is required for object_type "function"');
        }
        const encodedGroup = encodeURIComponent(String(args.function_group).toLowerCase());
        return `/sap/bc/adt/functions/groups/${encodedGroup}/fmodules/${encodedName}`;
    }

    const buildPath = OBJECT_PATHS[args.object_type];
    if (!buildPath) {
        const allowed = [...Object.keys(OBJECT_PATHS), 'function'].join(', ');
        throw new McpError(ErrorCode.InvalidParams, `object_type must be one of: ${allowed}`);
    }
    return buildPath(encodedName);
}

export async function handleGetUsageReferences(args: any) {
    try {
        const system = args?.sap_system || 'S4H';
        const objectPath = resolveObjectPath(args);
        const maxResults = args?.maxResults || 200;

        const url = `${await getBaseUrl(system)}/sap/bc/adt/repository/informationsystem/usageReferences?uri=${encodeURIComponent(objectPath)}`;
        const response = await makeAdtRequest(url, 'POST', 60000, REQUEST_BODY, undefined, system, {
            'Content-Type': 'application/vnd.sap.adt.repository.usagereferences.request.v1+xml',
            'Accept': 'application/vnd.sap.adt.repository.usagereferences.result.v1+xml',
        });

        const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        const references = parseReferences(body);

        // If the response format is not what we expect, hand back the raw XML instead of an empty list.
        if (references.length === 0 && body.includes('referencedObject')) {
            return { content: [{ type: 'text', text: body }] };
        }

        const result = {
            object: objectPath,
            system: String(system).toUpperCase(),
            count: references.length,
            truncated: references.length > maxResults,
            references: references.slice(0, maxResults),
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
        return return_error(error);
    }
}
