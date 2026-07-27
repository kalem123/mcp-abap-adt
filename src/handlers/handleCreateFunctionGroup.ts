import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, return_response, getBaseUrl } from '../lib/utils';

export async function handleCreateFunctionGroup(args: any) {
    try {
        if (!args?.function_group) {
            throw new McpError(ErrorCode.InvalidParams, 'function_group is required');
        }
        if (!args?.package_name) {
            throw new McpError(ErrorCode.InvalidParams, 'package_name is required');
        }
        if (!args?.transport) {
            throw new McpError(ErrorCode.InvalidParams, 'transport is required');
        }

        const system = args?.sap_system || 'S4H';
        const description = args?.description || args.function_group;
        const baseUrl = await getBaseUrl(system);
        const url = `${baseUrl}/sap/bc/adt/functions/groups`;

        const body = `<?xml version="1.0" encoding="UTF-8"?>
<group:abapFunctionGroup xmlns:group="http://www.sap.com/adt/functions/groups"
    xmlns:adtcore="http://www.sap.com/adt/core"
    adtcore:description="${description}"
    adtcore:name="${args.function_group}"
    adtcore:type="FUGR/F"
    adtcore:masterLanguage="EN">
  <adtcore:packageRef adtcore:name="${args.package_name}"/>
</group:abapFunctionGroup>`;

        const response = await makeAdtRequest(
            url,
            'POST',
            30000,
            body,
            { corrNr: args.transport },
            system,
            { 'Content-Type': 'application/vnd.sap.adt.functions.groups.v3+xml' }
        );
        return return_response(response);
    } catch (error) {
        return return_error(error);
    }
}
