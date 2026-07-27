import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, return_response, getBaseUrl } from '../lib/utils';

/**
 * Activates one or more inactive ADT objects after creation/editing.
 * object_refs: array of { uri, name } as returned/implied by the CreateX/SetSource calls,
 * e.g. { uri: "/sap/bc/adt/functions/groups/ZFG/fmodules/Z_FM", name: "Z_FM" }.
 */
export async function handleActivateObject(args: any) {
    try {
        if (!Array.isArray(args?.object_refs) || args.object_refs.length === 0) {
            throw new McpError(ErrorCode.InvalidParams, 'object_refs (non-empty array of {uri, name}) is required');
        }

        const system = args?.sap_system || 'S4H';
        const baseUrl = await getBaseUrl(system);

        const refsXml = args.object_refs
            .map((ref: { uri: string; name: string }) =>
                `<adtcore:objectReference adtcore:uri="${ref.uri}" adtcore:name="${ref.name}"/>`)
            .join('\n  ');

        const body = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  ${refsXml}
</adtcore:objectReferences>`;

        const url = `${baseUrl}/sap/bc/adt/activation`;
        const response = await makeAdtRequest(
            url,
            'POST',
            30000,
            body,
            { method: 'activate', preauditRequested: 'true' },
            system,
            { 'Content-Type': 'application/xml' }
        );
        return return_response(response);
    } catch (error) {
        return return_error(error);
    }
}
