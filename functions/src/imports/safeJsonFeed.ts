import { lookup as dnsLookup } from "node:dns";
import { type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest, Agent } from "node:https";
import { isIP, type LookupFunction } from "node:net";

const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 2_097_152;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 15_000;

export class SafeFeedError extends Error {
    constructor(readonly code: string) {
        super(code);
        this.name = "SafeFeedError";
    }
}

function containsControlCharacters(value: string): boolean {
    return Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
    });
}

export function isPublicFeedAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 4) {
        const octets = address.split(".").map(Number);
        const [a, b, c] = octets;
        if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
        if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
        if (a === 100 && b >= 64 && b <= 127) return false;
        if (a === 169 && b === 254) return false;
        if (a === 172 && b >= 16 && b <= 31) return false;
        if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
        if (a === 192 && b === 168) return false;
        if (a === 192 && b === 88 && c === 99) return false;
        if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
        if (a === 203 && b === 0 && c === 113) return false;
        return true;
    }

    if (family !== 6) return false;
    const normalized = address.toLowerCase().split("%")[0];
    // Allow only globally routable unicast; reject reserved and special-purpose
    // ranges even when they sit inside the broad 2000::/3 global-unicast block.
    const firstGroup = Number.parseInt(normalized.split(":")[0] || "0", 16);
    const secondGroup = Number.parseInt(normalized.split(":")[1] || "0", 16);
    if (firstGroup < 0x2000 || firstGroup > 0x3eff || normalized.startsWith("::ffff:")) return false;
    if (firstGroup === 0x2001 && secondGroup <= 0x01ff) return false; // IETF protocol assignments, including Teredo/benchmarking.
    if (firstGroup === 0x2001 && normalized.startsWith("2001:db8:")) return false; // Documentation.
    if (firstGroup === 0x2002) return false; // Deprecated 6to4.
    return true;
}

function safeLookup(allowedHostname: string): LookupFunction {
    return (hostname, options, callback) => {
        if (hostname.toLowerCase() !== allowedHostname) {
            callback(Object.assign(new Error("feed-host-changed"), { code: "EHOSTUNREACH" }), "", 0);
            return;
        }
        dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
            if (error) {
                callback(error, "", 0);
                return;
            }
            if (!addresses.length || addresses.some(({ address }) => !isPublicFeedAddress(address))) {
                callback(Object.assign(new Error("feed-host-resolves-to-private-address"), { code: "EHOSTUNREACH" }), "", 0);
                return;
            }
            const compatibleAddresses = options.family
                ? addresses.filter(({ family }) => family === options.family)
                : addresses;
            if (!compatibleAddresses.length) {
                callback(Object.assign(new Error("feed-host-address-family-unavailable"), { code: "EHOSTUNREACH" }), "", 0);
                return;
            }
            if (options.all) callback(null, compatibleAddresses);
            else callback(null, compatibleAddresses[0].address, compatibleAddresses[0].family);
        });
    };
}

export function validateSafeFeedEndpoint(value: string, allowedHosts: readonly string[]): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new SafeFeedError("invalid-feed-url");
    }
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
        url.hash || isIP(hostname) !== 0 || !allowedHosts.includes(hostname) ||
        hostname.endsWith(".") || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
        throw new SafeFeedError("unsafe-feed-endpoint");
    }
    return url;
}

export function parseSafeJsonResponse(
    statusCode: number,
    headers: IncomingHttpHeaders,
    body: Buffer,
    maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
): unknown {
    if (statusCode >= 300 && statusCode < 400) throw new SafeFeedError("feed-redirect-rejected");
    if (statusCode !== 200) throw new SafeFeedError("feed-http-error");
    const contentType = headers["content-type"];
    if (typeof contentType !== "string" || !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|\s*$)/i.test(contentType)) {
        throw new SafeFeedError("feed-content-type-rejected");
    }
    const normalizedMax = Number.isFinite(maxBytes)
        ? Math.min(Math.max(Math.floor(maxBytes), 1), MAX_RESPONSE_BYTES)
        : DEFAULT_MAX_RESPONSE_BYTES;
    const contentLengthHeader = headers["content-length"];
    if (typeof contentLengthHeader === "string" && /^\d+$/.test(contentLengthHeader) && Number(contentLengthHeader) > normalizedMax) {
        throw new SafeFeedError("feed-response-too-large");
    }
    if (body.byteLength > normalizedMax) throw new SafeFeedError("feed-response-too-large");
    try {
        return JSON.parse(body.toString("utf8")) as unknown;
    } catch {
        throw new SafeFeedError("feed-invalid-json");
    }
}

export async function fetchSafeJsonFeed(
    value: string,
    allowedHosts: readonly string[],
    signal: AbortSignal,
    options: { maxBytes?: number; timeoutMs?: number; bearerToken?: string } = {},
): Promise<unknown> {
    const url = validateSafeFeedEndpoint(value, allowedHosts);
    const maxBytes = Number.isFinite(options.maxBytes)
        ? Math.min(Math.max(Math.floor(options.maxBytes as number), 1), MAX_RESPONSE_BYTES)
        : DEFAULT_MAX_RESPONSE_BYTES;
    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.min(Math.max(Math.floor(options.timeoutMs as number), 1), MAX_TIMEOUT_MS)
        : DEFAULT_TIMEOUT_MS;
    if (options.bearerToken !== undefined &&
        (options.bearerToken.length === 0 || options.bearerToken.length > 4096 || containsControlCharacters(options.bearerToken))) {
        throw new SafeFeedError("invalid-feed-credential");
    }
    const agent = new Agent({ lookup: safeLookup(url.hostname.toLowerCase()), maxSockets: 1, keepAlive: false });

    try {
        return await new Promise<unknown>((resolve, reject) => {
            if (signal.aborted) {
                reject(new SafeFeedError("feed-aborted"));
                return;
            }
            const request = httpsRequest(url, {
                method: "GET",
                agent,
                timeout: timeoutMs,
                headers: {
                    accept: "application/json",
                    "accept-encoding": "identity",
                    ...(options.bearerToken ? { authorization: `Bearer ${options.bearerToken}` } : {}),
                },
            }, (response) => {
                const chunks: Buffer[] = [];
                let responseBytes = 0;
                const contentLength = response.headers["content-length"];
                if (typeof contentLength === "string" && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
                    response.destroy(new SafeFeedError("feed-response-too-large"));
                    return;
                }
                response.on("data", (chunk: Buffer | string) => {
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    responseBytes += buffer.byteLength;
                    if (responseBytes > maxBytes) {
                        response.destroy(new SafeFeedError("feed-response-too-large"));
                        return;
                    }
                    chunks.push(buffer);
                });
                response.on("end", () => {
                    try {
                        resolve(parseSafeJsonResponse(response.statusCode ?? 0, response.headers, Buffer.concat(chunks), maxBytes));
                    } catch (error) {
                        reject(error);
                    }
                });
                response.on("error", reject);
            });
            const onAbort = () => request.destroy(new SafeFeedError("feed-aborted"));
            signal.addEventListener("abort", onAbort, { once: true });
            request.setTimeout(timeoutMs, () => request.destroy(new SafeFeedError("feed-timeout")));
            request.on("error", reject);
            request.on("close", () => signal.removeEventListener("abort", onAbort));
            request.end();
        });
    } finally {
        agent.destroy();
    }
}

export const SAFE_FEED_LIMITS = {
    defaultMaxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    maxTimeoutMs: MAX_TIMEOUT_MS,
} as const;
