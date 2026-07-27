import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, return_response, getBaseUrl } from '../lib/utils';

/**
 * Creates a Service Definition shell exposing a CDS root view (and its
 * compositions, e.g. the Deep Entity item table) as an OData entity set.
 * Populate the actual "define service ... { expose ... as ...; }" text via
 * SetSource, then activate via ActivateObject.
 */
export async function handleCreateServiceDefinition(args: any) {
    try {
        if (!args?.srvd_name) {
            throw new McpError(ErrorCode.InvalidParams, 'srvd_name is required');
        }
        if (!args?.package_name) {
            throw new McpError(ErrorCode.InvalidParams, 'package_name is required');
        }
        if (!args?.transport) {
            throw new McpError(ErrorCode.InvalidParams, 'transport is required');
        }

        const system = args?.sap_system || 'S4H';
        const description = args?.description || args.srvd_name;
        const baseUrl = await getBaseUrl(system);
        const url = `${baseUrl}/sap/bc/adt/ddic/srvd/sources`;

        const body = `<?xml version="1.0" encoding="UTF-8"?>
<blue:blueSource xmlns:blue="http://www.sap.com/adt/ddic/srvdsources"
    xmlns:adtcore="http://www.sap.com/adt/core"
    adtcore:description="${description}"
    adtcore:name="${args.srvd_name}"
    adtcore:type="SRVD/SRV"
    adtcore:masterLanguage="EN">
  <adtcore:packageRef adtcore:name="${args.package_name}"/>
</blue:blueSource>`;

        const response = await makeAdtRequest(
            url,
            'POST',
            30000,
            body,
            { corrNr: args.transport },
            system,
            { 'Content-Type': 'application/vnd.sap.adt.ddic.srvd.sources.v2+xml' }
        );
        return return_response(response);
    } catch (error) {
        return return_error(error);
    }
}
