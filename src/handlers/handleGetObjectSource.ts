import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, return_response, getBaseUrl } from '../lib/utils';

const SOURCE_PATHS: Record<string, (name: string) => string[]> = {
    class_definitions: (n) => [`/sap/bc/adt/oo/classes/${n}/includes/definitions`, `/sap/bc/adt/oo/classes/${n}/includes/definitions/source/main`],
    class_implementations: (n) => [`/sap/bc/adt/oo/classes/${n}/includes/implementations`, `/sap/bc/adt/oo/classes/${n}/includes/implementations/source/main`],
    class_macros: (n) => [`/sap/bc/adt/oo/classes/${n}/includes/macros`, `/sap/bc/adt/oo/classes/${n}/includes/macros/source/main`],
    class_testclasses: (n) => [`/sap/bc/adt/oo/classes/${n}/includes/testclasses`, `/sap/bc/adt/oo/classes/${n}/includes/testclasses/source/main`],
    bdef: (n) => [`/sap/bc/adt/bo/behaviordefinitions/${n}/source/main`],
    ddls: (n) => [`/sap/bc/adt/ddic/ddl/sources/${n}/source/main`],
    srvd: (n) => [`/sap/bc/adt/ddic/srvd/sources/${n}/source/main`],
};

export async function handleGetObjectSource(args: any) {
    try {
        if (!args?.object_name) {
            throw new McpError(ErrorCode.InvalidParams, 'Object name is required');
        }
        const buildPaths = SOURCE_PATHS[args?.object_type];
        if (!buildPaths) {
            throw new McpError(ErrorCode.InvalidParams, `object_type must be one of: ${Object.keys(SOURCE_PATHS).join(', ')}`);
        }
        const system = args?.sap_system || 'S4H';
        const baseUrl = await getBaseUrl(system);
        const encodedName = encodeURIComponent(String(args.object_name).toLowerCase());

        let lastError: unknown;
        for (const path of buildPaths(encodedName)) {
            try {
                const response = await makeAdtRequest(`${baseUrl}${path}`, 'GET', 30000, undefined, undefined, system);
                return return_response(response);
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError;
    } catch (error) {
        return return_error(error);
    }
}
