import { McpError, ErrorCode } from '../lib/utils';
import { return_error, getOrCreateTransport } from '../lib/utils';

export async function handleCreateTransport(args: any) {
    try {
        if (!args?.package_name) {
            throw new McpError(ErrorCode.InvalidParams, 'package_name is required');
        }
        if (!args?.description) {
            throw new McpError(ErrorCode.InvalidParams, 'description is required');
        }

        const system = args?.sap_system || 'S4H';
        const transportNumber = await getOrCreateTransport(args.package_name, args.description, system);

        return {
            isError: false,
            content: [{ type: 'text', text: transportNumber }]
        };
    } catch (error) {
        return return_error(error);
    }
}
