import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, return_response, getBaseUrl } from '../lib/utils';

interface FmParameter {
    name: string;
    type: string;
    optional?: boolean;
    pass_by_value?: boolean;
}

/**
 * Creates the interface shell of an RFC-enabled function module. The
 * IMPORTING/EXPORTING/TABLES/EXCEPTIONS interface is structured ADT metadata,
 * not free text - the exact schema below is a best-effort first pass and may
 * need adjustment based on the live error response from the target system
 * (see plan doc: known risk, release-dependent schema).
 */
export async function handleCreateFunctionModule(args: any) {
    try {
        if (!args?.function_group) {
            throw new McpError(ErrorCode.InvalidParams, 'function_group is required');
        }
        if (!args?.function_module) {
            throw new McpError(ErrorCode.InvalidParams, 'function_module is required');
        }
        if (!args?.transport) {
            throw new McpError(ErrorCode.InvalidParams, 'transport is required');
        }

        const system = args?.sap_system || 'S4H';
        const description = args?.description || args.function_module;
        const rfcEnabled = args?.rfc_enabled !== false;
        const baseUrl = await getBaseUrl(system);
        const url = `${baseUrl}/sap/bc/adt/functions/groups/${encodeURIComponent(args.function_group)}/fmodules`;

        const paramXml = (params: FmParameter[] | undefined, tag: string) =>
            (params || []).map(p =>
                `    <fmodule:${tag} fmodule:name="${p.name}" fmodule:typeName="${p.type}" fmodule:optional="${p.optional ? 'true' : 'false'}" fmodule:passByValue="${p.pass_by_value !== false ? 'true' : 'false'}"/>`
            ).join('\n');

        const body = `<?xml version="1.0" encoding="UTF-8"?>
<fmodule:abapFunctionModule xmlns:fmodule="http://www.sap.com/adt/functions/fmodules"
    xmlns:adtcore="http://www.sap.com/adt/core"
    adtcore:description="${description}"
    adtcore:name="${args.function_module}"
    adtcore:type="FUGR/FF"
    fmodule:processingType="${rfcEnabled ? 'rfc' : 'normal'}"
    fmodule:releaseState="">
  <fmodule:importing>
${paramXml(args.importing, 'parameter')}
  </fmodule:importing>
  <fmodule:exporting>
${paramXml(args.exporting, 'parameter')}
  </fmodule:exporting>
  <fmodule:tables>
${paramXml(args.tables, 'parameter')}
  </fmodule:tables>
</fmodule:abapFunctionModule>`;

        const response = await makeAdtRequest(
            url,
            'POST',
            30000,
            body,
            { corrNr: args.transport },
            system,
            { 'Content-Type': 'application/vnd.sap.adt.functions.fmodules.v3+xml' }
        );
        return return_response(response);
    } catch (error) {
        return return_error(error);
    }
}
