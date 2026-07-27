import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, return_response, getBaseUrl } from '../lib/utils';

/**
 * Creates a CDS view (DDL source) shell. Populate the actual view body
 * afterwards via SetSource, then activate via ActivateObject.
 */
export async function handleCreateDdlSource(args: any) {
    try {
        if (!args?.ddl_name) {
            throw new McpError(ErrorCode.InvalidParams, 'ddl_name is required');
        }
        if (!args?.package_name) {
            throw new McpError(ErrorCode.InvalidParams, 'package_name is required');
        }
        if (!args?.transport) {
            throw new McpError(ErrorCode.InvalidParams, 'transport is required');
        }

        const system = args?.sap_system || 'S4H';
        const description = args?.description || args.ddl_name;
        const baseUrl = await getBaseUrl(system);
        const url = `${baseUrl}/sap/bc/adt/ddic/ddl/sources`;

        const body = `<?xml version="1.0" encoding="UTF-8"?>
<blueSource:blueSource xmlns:blueSource="http://www.sap.com/adt/ddic/ddlsources"
    xmlns:adtcore="http://www.sap.com/adt/core"
    adtcore:description="${description}"
    adtcore:name="${args.ddl_name}"
    adtcore:type="DDLS/DF"
    adtcore:masterLanguage="EN">
  <adtcore:packageRef adtcore:name="${args.package_name}"/>
</blueSource:blueSource>`;

        const response = await makeAdtRequest(
            url,
            'POST',
            30000,
            body,
            { corrNr: args.transport },
            system,
            { 'Content-Type': 'application/vnd.sap.adt.ddl.sources.v3+xml' }
        );
        return return_response(response);
    } catch (error) {
        return return_error(error);
    }
}
