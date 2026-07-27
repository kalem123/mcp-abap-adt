import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { Agent } from 'https';
import { AxiosResponse } from 'axios';
import { getConfig, SapConfig } from '../index';

export { McpError, ErrorCode, AxiosResponse };

export function return_response(response: AxiosResponse) {
    const text = typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data, null, 2);
    return {
        isError: false,
        content: [{
            type: 'text',
            text
        }]
    };
}

export function return_error(error: any) {
    let message: string;
    if (error instanceof AxiosError) {
        message = error.response?.data
            ? (typeof error.response.data === 'string'
                ? error.response.data
                : JSON.stringify(error.response.data, null, 2))
            : `${error.message} (${error.code ?? 'no code'})`;
    } else if (error instanceof Error) {
        message = error.message;
    } else {
        message = String(error);
    }
    return {
        isError: true,
        content: [{
            type: 'text',
            text: `Error: ${message}`
        }]
    };
}

let axiosInstance: AxiosInstance | null = null;
export function createAxiosInstance() {
    if (!axiosInstance) {
        axiosInstance = axios.create({
            httpsAgent: new Agent({
                rejectUnauthorized: false
            })
        });
    }
    return axiosInstance;
}

// Per-system caches
const configCache = new Map<string, SapConfig>();
const csrfTokenCache = new Map<string, string>();
const cookiesCache = new Map<string, string>();

export function cleanup() {
    if (axiosInstance) {
        const reqInterceptor = axiosInstance.interceptors.request.use((config) => config);
        const resInterceptor = axiosInstance.interceptors.response.use((response) => response);
        axiosInstance.interceptors.request.eject(reqInterceptor);
        axiosInstance.interceptors.response.eject(resInterceptor);
    }
    axiosInstance = null;
    configCache.clear();
    csrfTokenCache.clear();
    cookiesCache.clear();
}

function getSystemConfig(system: string = 'S4H'): SapConfig {
    const key = system.toUpperCase();
    if (!configCache.has(key)) {
        configCache.set(key, getConfig(key));
    }
    return configCache.get(key)!;
}

export async function getBaseUrl(system: string = 'S4H') {
    const { url } = getSystemConfig(system);
    try {
        const urlObj = new URL(url);
        return urlObj.origin;
    } catch (error) {
        throw new Error(`Invalid URL in configuration: ${error instanceof Error ? error.message : error}`);
    }
}

export async function getAuthHeaders(system: string = 'S4H') {
    const { username, password, client } = getSystemConfig(system);
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    return {
        'Authorization': `Basic ${auth}`,
        'X-SAP-Client': client
    };
}

async function fetchCsrfToken(url: string, system: string): Promise<string> {
    try {
        const response = await createAxiosInstance()({
            method: 'GET',
            url,
            headers: {
                ...(await getAuthHeaders(system)),
                'x-csrf-token': 'fetch'
            }
        });

        const token = response.headers['x-csrf-token'];
        if (!token) {
            throw new Error('No CSRF token in response headers');
        }

        if (response.headers['set-cookie']) {
            cookiesCache.set(system.toUpperCase(), response.headers['set-cookie'].join('; '));
        }

        return token;
    } catch (error) {
        if (error instanceof AxiosError && error.response?.headers['x-csrf-token']) {
            const token = error.response.headers['x-csrf-token'];
            if (token) {
                if (error.response.headers['set-cookie']) {
                    cookiesCache.set(system.toUpperCase(), error.response.headers['set-cookie'].join('; '));
                }
                return token;
            }
        }
        throw new Error(`Failed to fetch CSRF token: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export interface LockResult {
    lockHandle: string;
}

/**
 * Locks an ADT object for editing. Requires a stateful session, which is why
 * the session cookie captured during CSRF fetch/requests is reused here.
 */
export async function lockObject(objectUrl: string, system: string = 'S4H'): Promise<LockResult> {
    const sysKey = system.toUpperCase();
    if (!csrfTokenCache.has(sysKey)) {
        csrfTokenCache.set(sysKey, await fetchCsrfToken(objectUrl, system));
    }

    const headers: any = {
        ...(await getAuthHeaders(system)),
        'x-csrf-token': csrfTokenCache.get(sysKey),
        'X-sap-adt-sessiontype': 'stateful',
        'Accept': 'application/*'
    };
    if (cookiesCache.has(sysKey)) {
        headers['Cookie'] = cookiesCache.get(sysKey);
    }

    const response = await createAxiosInstance()({
        method: 'POST',
        url: objectUrl,
        params: { '_action': 'LOCK', accessMode: 'MODIFY' },
        headers,
        timeout: 30000
    });

    if (response.headers['set-cookie']) {
        cookiesCache.set(sysKey, response.headers['set-cookie'].join('; '));
    }

    const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const match = body.match(/LOCK_HANDLE[^>]*>([^<]*)</i);
    const lockHandle = match?.[1];
    if (!lockHandle) {
        throw new Error(`Failed to obtain lock handle for ${objectUrl}: ${body}`);
    }

    return { lockHandle };
}

/**
 * Releases a lock previously obtained via lockObject. Best-effort: errors are
 * surfaced to the caller so a failed unlock isn't silently swallowed.
 */
export async function unlockObject(objectUrl: string, lockHandle: string, system: string = 'S4H'): Promise<void> {
    const sysKey = system.toUpperCase();
    const headers: any = {
        ...(await getAuthHeaders(system)),
        'x-csrf-token': csrfTokenCache.get(sysKey),
        'X-sap-adt-sessiontype': 'stateful'
    };
    if (cookiesCache.has(sysKey)) {
        headers['Cookie'] = cookiesCache.get(sysKey);
    }

    await createAxiosInstance()({
        method: 'POST',
        url: objectUrl,
        params: { '_action': 'UNLOCK', lockHandle },
        headers,
        timeout: 30000
    });
}

/**
 * Returns an existing transport request if one was supplied, otherwise creates
 * a new workbench request via the ADT CTS API and returns its number.
 */
export async function getOrCreateTransport(
    packageName: string,
    description: string,
    system: string = 'S4H',
    transport?: string
): Promise<string> {
    if (transport) {
        return transport;
    }

    const url = `${await getBaseUrl(system)}/sap/bc/adt/cts/transportrequests`;
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm" tm:number="" tm:targetsystem="" tm:cts_project="">
  <tm:request tm:desc="${description}" tm:type="K" tm:target=""/>
  <tm:task/>
  <tm:comment/>
  <tm:targetsystem/>
  <tm:transportofcopies/>
  <tm:reference/>
  <tm:abap_language_version/>
  <tm:package tm:name="${packageName}"/>
</tm:root>`;

    const response = await makeAdtRequest(url, 'POST', 30000, body, undefined, system,
        { 'Content-Type': 'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.CreateCorrectionRequest' });
    const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const match = responseBody.match(/"?(?:REQUEST|number)"?[^A-Z0-9]*([A-Z][A-Z0-9]\dK\d{6})/i)
        || responseBody.match(/([A-Z][A-Z0-9]\dK\d{6})/);
    const transportNumber = match?.[1];
    if (!transportNumber) {
        throw new Error(`Failed to parse transport number from response: ${responseBody}`);
    }
    return transportNumber;
}

export async function makeAdtRequest(url: string, method: string, timeout: number, data?: any, params?: any, system: string = 'S4H', extraHeaders?: Record<string, string>) {
    const sysKey = system.toUpperCase();

    if ((method === 'POST' || method === 'PUT') && !csrfTokenCache.has(sysKey)) {
        try {
            csrfTokenCache.set(sysKey, await fetchCsrfToken(url, system));
        } catch (error) {
            throw new Error('CSRF token is required for POST/PUT requests but could not be fetched');
        }
    }

    const requestHeaders: any = {
        ...(await getAuthHeaders(system)),
        'Accept': 'text/plain, */*',
        ...extraHeaders
    };

    if ((method === 'POST' || method === 'PUT') && csrfTokenCache.has(sysKey)) {
        requestHeaders['x-csrf-token'] = csrfTokenCache.get(sysKey);
    }

    if (cookiesCache.has(sysKey)) {
        requestHeaders['Cookie'] = cookiesCache.get(sysKey);
    }

    const reqConfig: any = {
        method,
        url,
        headers: requestHeaders,
        timeout,
        params: params
    };

    if (data) {
        reqConfig.data = data;
    }

    try {
        const response = await createAxiosInstance()(reqConfig);
        return response;
    } catch (error) {
        if (error instanceof AxiosError && error.response?.status === 403 &&
            error.response.data?.includes('CSRF')) {
            const newToken = await fetchCsrfToken(url, system);
            csrfTokenCache.set(sysKey, newToken);
            reqConfig.headers['x-csrf-token'] = newToken;
            return await createAxiosInstance()(reqConfig);
        }
        throw error;
    }
}
