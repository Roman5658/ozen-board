import { HttpsError } from "firebase-functions/v2/https";

export type TelegramAdminAuth = { token: Record<string, unknown> } | undefined;
type TelegramWebhookResult = { registered: true } | { deleted: true } | TelegramWebhookStatus;
export type TelegramWebhookStatus = {
    registered: boolean;
    configuredEndpointMatches: boolean;
    pendingUpdateCount: number | null;
    maxConnections: number | null;
    allowedUpdates: string[];
    lastErrorDate: number | null;
};
type FetchImplementation = typeof fetch;

const ADMIN_EMAILS = new Set(["ozenenesis56@gmail.com", "u8075026427@gmail.com"]);
const BOT_TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

/** Existing server-side email allowlist, gated by the signed Firebase email_verified claim. */
export function requireTelegramAdmin(auth: TelegramAdminAuth): void {
    const email = typeof auth?.token.email === "string" ? auth.token.email.trim().toLowerCase() : "";
    if (!email) throw new HttpsError("unauthenticated", "Zaloguj się jako administrator.");
    if (auth?.token.email_verified !== true || !ADMIN_EMAILS.has(email)) {
        throw new HttpsError("permission-denied", "Brak uprawnień administratora.");
    }
}

function requireBotToken(value: string): string {
    if (!BOT_TOKEN_PATTERN.test(value)) {
        throw new HttpsError("failed-precondition", "Telegram server token is not configured correctly.");
    }
    return value;
}

export function requireTelegramWebhookUrl(value: string | undefined): string {
    if (!value) throw new HttpsError("failed-precondition", "Skonfiguruj adres Telegram webhook.");
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new HttpsError("failed-precondition", "Nieprawidłowy adres Telegram webhook.");
    }
    const allowedHost = url.hostname.endsWith(".cloudfunctions.net") || url.hostname.endsWith(".run.app");
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !allowedHost) {
        throw new HttpsError("failed-precondition", "Invalid Telegram webhook URL.");
    }
    return url.toString();
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function callTelegramBotApi(
    token: string,
    method: "setWebhook" | "deleteWebhook" | "getWebhookInfo",
    payload: Record<string, unknown>,
    fetchImplementation: FetchImplementation,
): Promise<Record<string, unknown>> {
    const safeToken = requireBotToken(token);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetchImplementation(`https://api.telegram.org/bot${safeToken}/${method}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            redirect: "error",
            signal: controller.signal,
        });
        const result: unknown = await response.json().catch(() => null);
        if (!response.ok || !isObject(result) || result.ok !== true) {
            // Telegram descriptions and transport errors are deliberately not echoed or logged.
            throw new HttpsError("unavailable", "Telegram rejected the webhook operation.");
        }
        return result;
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("unavailable", "Telegram webhook operation failed.");
    } finally {
        clearTimeout(timeout);
    }
}

/** Testable server operation used by the register callable. It never returns token material. */
export async function registerTelegramWebhook(
    auth: TelegramAdminAuth,
    options: {
        botToken: string;
        webhookSecret: string;
        webhookUrl: string | undefined;
        fetchImplementation?: FetchImplementation;
    },
): Promise<TelegramWebhookResult> {
    requireTelegramAdmin(auth);
    const webhookUrl = requireTelegramWebhookUrl(options.webhookUrl);
    if (!WEBHOOK_SECRET_PATTERN.test(options.webhookSecret)) {
        throw new HttpsError("failed-precondition", "Telegram server secrets are not configured correctly.");
    }
    const currentInfo = await callTelegramBotApi(options.botToken, "getWebhookInfo", {}, options.fetchImplementation ?? fetch);
    if (!isObject(currentInfo.result) || typeof currentInfo.result.url !== "string") {
        throw new HttpsError("unavailable", "Telegram returned an invalid webhook status.");
    }
    const currentUrl = currentInfo.result.url;
    if (currentUrl && currentUrl !== webhookUrl) {
        throw new HttpsError("failed-precondition", "A different Telegram webhook is already configured; remove it explicitly first.");
    }

    const registration = await callTelegramBotApi(options.botToken, "setWebhook", {
        url: webhookUrl,
        secret_token: options.webhookSecret,
        allowed_updates: ["message", "channel_post", "edited_message", "edited_channel_post"],
        drop_pending_updates: false,
        max_connections: 5,
    }, options.fetchImplementation ?? fetch);
    if (registration.result !== true) {
        throw new HttpsError("unavailable", "Telegram did not confirm webhook registration.");
    }
    return { registered: true };
}

/** Testable server operation used by the delete callable. Pending Telegram updates are retained. */
export async function deleteTelegramWebhook(
    auth: TelegramAdminAuth,
    options: { botToken: string; fetchImplementation?: FetchImplementation },
): Promise<TelegramWebhookResult> {
    requireTelegramAdmin(auth);
    const deletion = await callTelegramBotApi(options.botToken, "deleteWebhook", {
        drop_pending_updates: false,
    }, options.fetchImplementation ?? fetch);
    if (deletion.result !== true) {
        throw new HttpsError("unavailable", "Telegram did not confirm webhook removal.");
    }
    return { deleted: true };
}

/** Exposes a minimal getWebhookInfo view without returning the URL or raw Telegram errors. */
export async function getTelegramWebhookStatus(
    auth: TelegramAdminAuth,
    options: {
        botToken: string;
        webhookUrl?: string;
        fetchImplementation?: FetchImplementation;
    },
): Promise<TelegramWebhookStatus> {
    requireTelegramAdmin(auth);
    const expectedUrl = options.webhookUrl ? requireTelegramWebhookUrl(options.webhookUrl) : undefined;
    const response = await callTelegramBotApi(options.botToken, "getWebhookInfo", {}, options.fetchImplementation ?? fetch);
    const info = response.result;
    if (!isObject(info) || typeof info.url !== "string") {
        throw new HttpsError("unavailable", "Telegram returned an invalid webhook status.");
    }
    const infoUrl = info.url;
    return {
        registered: infoUrl.length > 0,
        configuredEndpointMatches: Boolean(expectedUrl && infoUrl === expectedUrl),
        pendingUpdateCount: Number.isSafeInteger(info.pending_update_count) && (info.pending_update_count as number) >= 0
            ? info.pending_update_count as number
            : null,
        maxConnections: Number.isSafeInteger(info.max_connections) && (info.max_connections as number) >= 1
            ? info.max_connections as number
            : null,
        allowedUpdates: Array.isArray(info.allowed_updates)
            ? info.allowed_updates.filter((value): value is string => typeof value === "string").slice(0, 20)
            : [],
        lastErrorDate: Number.isSafeInteger(info.last_error_date) && (info.last_error_date as number) > 0
            ? info.last_error_date as number
            : null,
    };
}
