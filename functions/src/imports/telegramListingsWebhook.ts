import { randomUUID } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import type { Request, Response } from "express";
import {
    loadTelegramListingsConfig,
    getTelegramUpdateMessage,
    getTelegramUpdateChatId,
    getTelegramUpdateId,
    isTelegramEditedUpdate,
    lookupTelegramChatSource,
    evaluateTelegramAdMessage,
    parseTelegramAdMessage,
} from "./telegramListingsAdapter";
import { isAuthorizedTelegramWebhookSecret } from "./telegramWebhookSecurity";
import { FirestoreTelegramUpdateLedger, type TelegramUpdateId } from "./telegramUpdateLedger";
import { FirestoreTelegramUpdateRateLimiter } from "./telegramUpdateRateLimiter";
import { buildTelegramUpdateFromCollectorPayload, hasExplicitTelegramCollectorSenderAllowlist } from "./telegramCollectorAdapter";
import { isAuthorizedTelegramCollectorRequest } from "./telegramCollectorSecurity";
import {
    deactivateTelegramListingAsAdmin,
} from "./telegramListingLifecycle";
import {
    deleteTelegramWebhook,
    getTelegramWebhookStatus,
    registerTelegramWebhook,
    requireTelegramAdmin,
} from "./telegramWebhookAdmin";
import { deactivateTelegramImportRecord, deleteTelegramPhotos, ingestTelegramAd, inspectTelegramImport, storeTelegramPhotoBytes, storeTelegramPhotos, type StoredTelegramImages } from "./telegramAds";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_WEBHOOK_SECRET = defineSecret("TELEGRAM_WEBHOOK_SECRET");
const TELEGRAM_COLLECTOR_HMAC_SECRET = defineSecret("TELEGRAM_COLLECTOR_HMAC_SECRET");
const updateLedger = new FirestoreTelegramUpdateLedger(db);
const updateRateLimiter = new FirestoreTelegramUpdateRateLimiter(db);

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reply(res: Response, status: number, body: string): void {
    res.status(status).type("text/plain").send(body);
}

type TelegramPhotoLoader = (parsed: Awaited<ReturnType<typeof parseTelegramAdMessage>>) => Promise<StoredTelegramImages>;

/** Shared server-side validation, deduplication, media, review and publication path for both transports. */
async function processAuthenticatedTelegramUpdate(
    update: Record<string, unknown>,
    updateId: TelegramUpdateId,
    res: Response,
    loadPhotos: TelegramPhotoLoader,
    photoUnavailable = false,
    requireExplicitSenderAllowlist = false,
): Promise<void> {
    let config;
    try {
        config = loadTelegramListingsConfig();
    } catch {
        console.error("Telegram import unavailable", { reason: "invalid_source_configuration" });
        reply(res, 503, "import unavailable");
        return;
    }
    if (!config) {
        console.info("Telegram update ignored", { reason: "import_disabled" });
        reply(res, 200, "disabled");
        return;
    }

    const chatId = getTelegramUpdateChatId(update);
    const message = getTelegramUpdateMessage(update);
    if (!message) {
        console.info("Telegram update ignored", { reason: "unsupported_update" });
        reply(res, 200, "ignored");
        return;
    }
    const chatSourceLookup = lookupTelegramChatSource(chatId, config.chats);
    if (!chatSourceLookup.found) {
        console.info("Telegram update ignored", { reason: chatSourceLookup.reason });
        reply(res, 200, "ignored");
        return;
    }
    const chatSource = chatSourceLookup.source;
    if (requireExplicitSenderAllowlist && !hasExplicitTelegramCollectorSenderAllowlist(chatSource)) {
        console.info("Telegram collector candidate ignored", {
            stage: "source_author_policy",
            reason: "sender_allowlist_not_configured",
        });
        reply(res, 200, "ignored");
        return;
    }

    const claimToken = randomUUID();
    let claim;
    try {
        claim = await updateLedger.claim(updateId, Date.now(), claimToken);
    } catch {
        console.error("Telegram webhook could not claim an update because storage is unavailable.");
        reply(res, 503, "retry");
        return;
    }
    if (claim === "processed") {
        console.info("Telegram update ignored", { reason: "duplicate_update" });
        reply(res, 200, "duplicate");
        return;
    }
    if (claim === "busy") {
        console.info("Telegram update deferred", { reason: "update_in_progress" });
        reply(res, 503, "retry");
        return;
    }

    try {
        const withinRateLimit = await updateRateLimiter.allow(chatSource.source.id, Date.now(), chatSource.maxUpdatesPerMinute);
        if (!withinRateLimit) {
            await updateLedger.release(updateId, claimToken);
            console.info("Telegram update deferred", { reason: "rate_limited" });
            reply(res, 503, "retry");
            return;
        }
        const evaluation = evaluateTelegramAdMessage(message, chatSource);
        if (evaluation.decision === "reject") {
            console.info("Telegram listing skipped", { stage: "source_and_message_validation", reason: evaluation.reason });
            if (!await updateLedger.finish(updateId, claimToken, Date.now())) {
                reply(res, 503, "retry");
                return;
            }
            reply(res, 200, "skipped");
            return;
        }
        let parsed = evaluation.parsed;

        if (photoUnavailable) {
            parsed = {
                ...parsed,
                photoFileIds: [],
                decision: "needs_review",
                autoPublishEligible: false,
                reviewReasons: Array.from(new Set([...parsed.reviewReasons, "photo_not_supported"])),
            };
        }

        const edited = isTelegramEditedUpdate(update);
        const previous = await inspectTelegramImport(db, parsed, edited);
        if (previous !== "continue") {
            console.info("Telegram listing ignored", { stage: "message_deduplication", reason: previous });
            if (!await updateLedger.finish(updateId, claimToken, Date.now())) {
                reply(res, 503, "retry");
                return;
            }
            reply(res, 200, previous);
            return;
        }

        let storedImages: StoredTelegramImages = { urls: [], paths: [] };
        if (parsed.photoFileIds.length) {
            try {
                storedImages = await loadPhotos(parsed);
            } catch (error) {
                const code = error instanceof Error ? error.message : "";
                if (code === "telegram-image-too-large" || code === "telegram-image-type-unsupported") {
                    parsed = {
                        ...parsed,
                        photoFileIds: [],
                        decision: "needs_review",
                        autoPublishEligible: false,
                        reviewReasons: Array.from(new Set([...parsed.reviewReasons, "photo_not_supported"])),
                    };
                } else {
                    await updateLedger.release(updateId, claimToken);
                    console.error("Telegram media import deferred", { reason: "media_transfer_failed" });
                    reply(res, 503, "retry");
                    return;
                }
            }
        }

        let result;
        try {
            result = await ingestTelegramAd(db, parsed, storedImages, edited);
        } catch {
            await updateLedger.release(updateId, claimToken);
            console.error("Telegram import run incomplete", { reason: "import_storage_failed" });
            reply(res, 503, "retry");
            return;
        }
        if (result === "daily_limit" && storedImages.paths.length) {
            await deleteTelegramPhotos(storedImages.paths).catch(() => {
                console.error("Telegram media cleanup deferred", { reason: "daily_limit_cleanup_failed" });
            });
        }
        console.info("Telegram update handled", {
            created: result === "created" ? 1 : 0,
            updated: result === "updated_review" || result === "edited_needs_review" ? 1 : 0,
            reviewed: result === "review" ? 1 : 0,
            limited: result === "daily_limit" ? 1 : 0,
            skipped: result === "duplicate" || result === "sticky_terminal" ? 1 : 0,
            result,
        });
        if (result === "daily_limit") {
            // Keep the authenticated update retryable; the local collector also retains it in its outbox.
            await updateLedger.release(updateId, claimToken);
            res.set("Retry-After", "3600");
            reply(res, 503, "retry");
            return;
        }
        if (!await updateLedger.finish(updateId, claimToken, Date.now())) {
            reply(res, 503, "retry");
            return;
        }
        reply(res, 200, result);
    } catch {
        try {
            await updateLedger.release(updateId, claimToken);
        } catch {
            // The lease allows a later retry to recover if Firestore is temporarily unavailable.
        }
        console.error("Telegram update import failed; the update can be retried.", { reason: "import_failed" });
        reply(res, 503, "retry");
    }
}

async function handleTelegramWebhook(req: Request, res: Response): Promise<void> {
    if (req.method !== "POST") {
        reply(res, 405, "method not allowed");
        return;
    }

    let webhookSecret: string;
    try {
        webhookSecret = TELEGRAM_WEBHOOK_SECRET.value();
    } catch {
        reply(res, 503, "webhook unavailable");
        return;
    }
    if (!isAuthorizedTelegramWebhookSecret(webhookSecret, req.get("X-Telegram-Bot-Api-Secret-Token"))) {
        reply(res, 401, "unauthorized");
        return;
    }
    if (!req.is("application/json") || !isJsonObject(req.body) || Buffer.byteLength(JSON.stringify(req.body)) > 256 * 1024) {
        // The sender is authenticated; acknowledge malformed or unsupported payloads to avoid retry storms.
        console.info("Telegram update ignored", { reason: "invalid_update_payload" });
        reply(res, 200, "ignored");
        return;
    }
    const updateId = getTelegramUpdateId(req.body);
    if (updateId === undefined) {
        console.info("Telegram update ignored", { reason: "invalid_update_id" });
        reply(res, 200, "ignored");
        return;
    }
    await processAuthenticatedTelegramUpdate(req.body, updateId, res, async (parsed) => {
        let botToken: string;
        try {
            botToken = TELEGRAM_BOT_TOKEN.value();
        } catch {
            throw new Error("bot_token_unavailable");
        }
        return storeTelegramPhotos(parsed, botToken);
    });
}

async function handleTelegramCollectorIngest(req: Request, res: Response): Promise<void> {
    if (req.method !== "POST") {
        reply(res, 405, "method not allowed");
        return;
    }

    const bodyRequest = req as Request & { rawBody?: Buffer };
    const rawBody = bodyRequest.rawBody;
    if (!req.is("application/json") || !Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > 12 * 1024 * 1024) {
        reply(res, 400, "invalid request");
        return;
    }

    let collectorSecret: string;
    try {
        collectorSecret = TELEGRAM_COLLECTOR_HMAC_SECRET.value();
    } catch {
        reply(res, 503, "collector unavailable");
        return;
    }
    if (!isAuthorizedTelegramCollectorRequest(
        collectorSecret,
        req.get("X-Telegram-Collector-Timestamp"),
        req.get("X-Telegram-Collector-Signature"),
        rawBody,
    )) {
        reply(res, 401, "unauthorized");
        return;
    }

    let normalized;
    try {
        normalized = buildTelegramUpdateFromCollectorPayload(req.body, rawBody);
    } catch {
        // The sender is authenticated; acknowledge invalid schema to prevent retry storms.
        console.info("Telegram collector candidate ignored", { stage: "payload_validation", reason: "invalid_payload" });
        reply(res, 200, "skipped");
        return;
    }

    await processAuthenticatedTelegramUpdate(
        normalized.update,
        normalized.updateId,
        res,
        async (parsed) => storeTelegramPhotoBytes(parsed, normalized.photoBytes),
        normalized.photoUnavailable,
        true,
    );
}

/** Telegram sends updates here. Only the dedicated Telegram webhook secret authenticates requests. */
export const telegramListingsWebhook = onRequest(
    {
        invoker: "public",
        timeoutSeconds: 60,
        maxInstances: 5,
        concurrency: 5,
        secrets: [TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN],
    },
    handleTelegramWebhook,
);

/** Authenticated server-to-server ingress for the owner-controlled Telethon collector. */
export const telegramCollectorIngest = onRequest(
    {
        region: "us-central1",
        invoker: "public",
        timeoutSeconds: 60,
        maxInstances: 3,
        concurrency: 5,
        secrets: [TELEGRAM_COLLECTOR_HMAC_SECRET],
    },
    handleTelegramCollectorIngest,
);

/** Registers the webhook using a server-side secret; never returns or logs the bot token. */
export const registerTelegramListingsWebhook = onCall(
    {
        timeoutSeconds: 20,
        maxInstances: 1,
        secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET],
    },
    async (request) => {
        requireTelegramAdmin(request.auth);
        let config;
        try {
            config = loadTelegramListingsConfig();
        } catch {
            throw new HttpsError("failed-precondition", "Telegram import configuration is invalid.");
        }
        if (!config) {
            throw new HttpsError("failed-precondition", "Telegram import is disabled or not fully configured.");
        }
        let botToken: string;
        let webhookSecret: string;
        try {
            botToken = TELEGRAM_BOT_TOKEN.value();
            webhookSecret = TELEGRAM_WEBHOOK_SECRET.value();
        } catch {
            throw new HttpsError("failed-precondition", "Telegram server secrets are not configured.");
        }
        return registerTelegramWebhook(request.auth, {
            botToken,
            webhookSecret,
            webhookUrl: process.env.TELEGRAM_LISTINGS_WEBHOOK_URL,
        });
    },
);

/** Removes the Telegram webhook without discarding pending updates or deleting its secrets. */
export const deleteTelegramListingsWebhook = onCall(
    {
        timeoutSeconds: 20,
        maxInstances: 1,
        secrets: [TELEGRAM_BOT_TOKEN],
    },
    async (request) => {
        requireTelegramAdmin(request.auth);
        let botToken: string;
        try {
            botToken = TELEGRAM_BOT_TOKEN.value();
        } catch {
            throw new HttpsError("failed-precondition", "Telegram bot token is not configured.");
        }
        return deleteTelegramWebhook(request.auth, { botToken });
    },
);

/** Reads only the safe operational subset of getWebhookInfo for a verified administrator. */
export const getTelegramListingsWebhookStatus = onCall(
    {
        timeoutSeconds: 20,
        maxInstances: 1,
        secrets: [TELEGRAM_BOT_TOKEN],
    },
    async (request) => {
        requireTelegramAdmin(request.auth);
        let botToken: string;
        try {
            botToken = TELEGRAM_BOT_TOKEN.value();
        } catch {
            throw new HttpsError("failed-precondition", "Telegram bot token is not configured.");
        }
        return getTelegramWebhookStatus(request.auth, {
            botToken,
            webhookUrl: process.env.TELEGRAM_LISTINGS_WEBHOOK_URL,
        });
    },
);

/** Hides one reviewed Telegram import. It never changes ads from users or other sources. */
export const deactivateTelegramListing = onCall(
    { timeoutSeconds: 20, maxInstances: 1 },
    async (request) => {
        const data = isJsonObject(request.data) ? request.data : {};
        if (typeof data.telegramImportId === "string") {
            requireTelegramAdmin(request.auth);
            const reason = typeof data.reason === "string" ? data.reason : "admin_deactivated";
            await deactivateTelegramImportRecord(db, data.telegramImportId, reason);
            return { deactivated: true };
        }
        return deactivateTelegramListingAsAdmin(request.auth, db, data.externalAdId, data.reason);
    },
);

