import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, return_response, getBaseUrl } from '../lib/utils';

/**
 * Creates a Behavior Definition shell for a CDS root view. Populate the
 * actual behavior text (implementation type, save sequence) afterwards via
 * SetSource, then activate via ActivateObject.
 */
export async function handleCreateBehaviorDefinition(args: any) {
    try {
        if (!args?.bdef_name) {
            throw new McpError(ErrorCode.InvalidParams, 'bdef_name is required');
        }
        if (!args?.implementing_entity) {
            throw new McpError(ErrorCode.InvalidParams, 'implementing_entity (the CDS root view name) is required');
        }
        if (!args?.package_name) {
            throw new McpError(ErrorCode.InvalidParams, 'package_name is required');
        }
        if (!args?.transport) {
            throw new McpError(ErrorCode.InvalidParams, 'transport is required');
        }

        const system = args?.sap_system || 'S4H';
        const description = args?.description || args.bdef_name;
        const baseUrl = await getBaseUrl(system);
        const url = `${baseUrl}/sap/bc/adt/bo/behaviordefinitions`;

        const body = `<?xml version="1.0" encoding="UTF-8"?>
<blue:blueSource xmlns:blue="http://www.sap.com/adt/bo/behaviordefinitions"
    xmlns:adtcore="http://www.sap.com/adt/core"
    adtcore:description="${description}"
    adtcore:name="${args.bdef_name}"
    adtcore:type="BDEF/BDO"
    adtcore:masterLanguage="EN">
  <adtcore:packageRef adtcore:name="${args.package_name}"/>
  <blue:implementingEntity adtcore:name="${args.implementing_entity}"/>
</blue:blueSource>`;

        const response = await makeAdtRequest(
            url,
            'POST',
            30000,
            body,
            { corrNr: args.transport },
            system,
            { 'Content-Type': 'application/vnd.sap.adt.bo.behaviordefinitions.v2+xml' }
        );
        return return_response(response);
    } catch (error) {
        return return_error(error);
    }
}
