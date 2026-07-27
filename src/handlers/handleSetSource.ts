import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, return_response, getBaseUrl, lockObject, unlockObject } from '../lib/utils';

/**
 * Writes source code to an existing ADT object (function module body, class
 * include/method, CDS DDL source, behavior definition text, ...). The object
 * must already exist (created via one of the CreateX handlers or via SAP GUI).
 */
export async function handleSetSource(args: any) {
    try {
        if (!args?.object_source_url) {
            throw new McpError(ErrorCode.InvalidParams, 'object_source_url is required (e.g. /sap/bc/adt/functions/groups/{fg}/fmodules/{fm}/source/main)');
        }
        if (args?.source === undefined) {
            throw new McpError(ErrorCode.InvalidParams, 'source is required');
        }
        if (!args?.transport) {
            throw new McpError(ErrorCode.InvalidParams, 'transport is required');
        }

        const system = args?.sap_system || 'S4H';
        const baseUrl = await getBaseUrl(system);
        const objectUrl = `${baseUrl}${args.object_source_url}`;

        const { lockHandle } = await lockObject(objectUrl, system);

        try {
            const response = await makeAdtRequest(
                objectUrl,
                'PUT',
                30000,
                args.source,
                { lockHandle, corrNr: args.transport },
                system,
                { 'Content-Type': 'text/plain; charset=utf-8' }
            );
            return return_response(response);
        } finally {
            await unlockObject(objectUrl, lockHandle, system);
        }
    } catch (error) {
        return return_error(error);
    }
}
