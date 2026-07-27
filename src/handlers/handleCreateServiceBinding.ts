import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, return_response, getBaseUrl } from '../lib/utils';

/**
 * Creates an OData service binding for a Service Definition and (optionally)
 * publishes it, which is what actually makes the service callable/testable
 * (equivalent to the "Publish" button in /IWFND/MAINT_SERVICE or Eclipse ADT).
 */
export async function handleCreateServiceBinding(args: any) {
    try {
        if (!args?.binding_name) {
            throw new McpError(ErrorCode.InvalidParams, 'binding_name is required');
        }
        if (!args?.service_definition) {
            throw new McpError(ErrorCode.InvalidParams, 'service_definition is required');
        }
        if (!args?.package_name) {
            throw new McpError(ErrorCode.InvalidParams, 'package_name is required');
        }
        if (!args?.transport) {
            throw new McpError(ErrorCode.InvalidParams, 'transport is required');
        }

        const system = args?.sap_system || 'S4H';
        const description = args?.description || args.binding_name;
        const bindingType = args?.binding_type || 'ODATA'; // ODATA (V2) or ODATA_V4
        const baseUrl = await getBaseUrl(system);
        const createUrl = `${baseUrl}/sap/bc/adt/businessservices/bindings`;

        const createBody = `<?xml version="1.0" encoding="UTF-8"?>
<blue:blueSource xmlns:blue="http://www.sap.com/adt/businessservices/servicebindings"
    xmlns:adtcore="http://www.sap.com/adt/core"
    adtcore:description="${description}"
    adtcore:name="${args.binding_name}"
    adtcore:type="SRVB/SVB"
    adtcore:masterLanguage="EN">
  <adtcore:packageRef adtcore:name="${args.package_name}"/>
  <blue:serviceDefinition adtcore:name="${args.service_definition}"/>
  <blue:bindingType blue:type="${bindingType}" blue:version="0001"/>
</blue:blueSource>`;

        const createResponse = await makeAdtRequest(
            createUrl,
            'POST',
            30000,
            createBody,
            { corrNr: args.transport },
            system,
            { 'Content-Type': 'application/vnd.sap.adt.businessservices.servicebindings.v2+xml' }
        );

        if (!args?.publish) {
            return return_response(createResponse);
        }

        const publishUrl = `${baseUrl}/sap/bc/adt/businessservices/odatav4/${encodeURIComponent(args.binding_name)}`;
        const publishResponse = await makeAdtRequest(
            publishUrl,
            'POST',
            30000,
            undefined,
            { action: 'publish' },
            system
        );
        return return_response(publishResponse);
    } catch (error) {
        return return_error(error);
    }
}
