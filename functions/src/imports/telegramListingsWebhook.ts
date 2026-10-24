import { randomUUID } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import type { Request, Response } from "express";
import {
    loadTelegramListingsConfig,
    getTelegramListingSkipReason,
    getTelegramUpdateMessage,
    getTelegramUpdateChatId,
    getTelegramUpdateId,
    isTelegramEditedUpdate,
    lookupTelegramChatSource,
    parseTelegramAdMessage,
} from "./telegramListingsAdapter";
import { isAuthorizedTelegramWebhookSecret } from "./telegramWebhookSecurity";
import { FirestoreTelegramUpdateLedger } from "./telegramUpdateLedger";
import { FirestoreTelegramUpdateRateLimiter } from "./telegramUpdateRateLimiter";
import {
    deactivateTelegramListingAsAdmin,
} from "./telegramListingLifecycle";
import {
    deleteTelegramWebhook,
    getTelegramWebhookStatus,
    registerTelegramWebhook,
    requireTelegramAdmin,
} from "./telegramWebhookAdmin";
import { deactivateTelegramImportRecord, ingestTelegramAd, inspectTelegramImport, storeTelegramPhotos } from "./telegramAds";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_WEBHOOK_SECRET = defineSecret("TELEGRAM_WEBHOOK_SECRET");
const updateLedger = new FirestoreTelegramUpdateLedger(db);
const updateRateLimiter = new FirestoreTelegramUpdateRateLimiter(db);

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reply(res: Response, status: number, body: string): void {
    res.status(status).type("text/plain").send(body);
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

    const updateId = getTelegramUpdateId(req.body);
    const chatId = getTelegramUpdateChatId(req.body);
    if (updateId === undefined) {
        console.info("Telegram update ignored", { reason: "invalid_update_id" });
        reply(res, 200, "ignored");
        return;
    }
    const message = getTelegramUpdateMessage(req.body);
    if (!message) {
        // Unrelated Telegram update kinds are deliberately ignored.
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
        let parsed;
        try {
            parsed = parseTelegramAdMessage(message, chatSource);
        } catch (error) {
            const reason = getTelegramListingSkipReason(error);
            console.info("Telegram listing skipped", { stage: "source_and_message_validation", reason });
            if (!await updateLedger.finish(updateId, claimToken, Date.now())) {
                reply(res, 503, "retry");
                return;
            }
            reply(res, 200, "skipped");
            return;
        }

        const previous = await inspectTelegramImport(db, parsed, isTelegramEditedUpdate(req.body));
        if (previous !== "continue") {
            console.info("Telegram listing ignored", { stage: "message_deduplication", reason: previous });
            if (!await updateLedger.finish(updateId, claimToken, Date.now())) {
                reply(res, 503, "retry");
                return;
            }
            reply(res, 200, previous);
            return;
        }

        let storedImages = { urls: [] as string[], paths: [] as string[] };
        if (parsed.photoFileIds.length) {
            let botToken: string;
            try {
                botToken = TELEGRAM_BOT_TOKEN.value();
            } catch {
                await updateLedger.release(updateId, claimToken);
                console.error("Telegram media import unavailable", { reason: "bot_token_unavailable" });
                reply(res, 503, "retry");
                return;
            }
            try {
                storedImages = await storeTelegramPhotos(parsed, botToken);
            } catch (error) {
                const code = error instanceof Error ? error.message : "";
                if (code === "telegram-image-too-large" || code === "telegram-image-type-unsupported") {
                    parsed = {
                        ...parsed,
                        photoFileIds: [],
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
            result = await ingestTelegramAd(db, parsed, storedImages, isTelegramEditedUpdate(req.body));
        } catch {
            await updateLedger.release(updateId, claimToken);
            console.error("Telegram import run incomplete", { reason: "import_storage_failed" });
            reply(res, 503, "retry");
            return;
        }
        console.info("Telegram update handled", {
            created: result === "created" ? 1 : 0,
            updated: result === "updated_review" || result === "edited_needs_review" ? 1 : 0,
            reviewed: result === "review" || result === "daily_limit" ? 1 : 0,
            skipped: result === "duplicate" || result === "sticky_terminal" ? 1 : 0,
            result,
        });
        if (!await updateLedger.finish(updateId, claimToken, Date.now())) {
            // If the lease expired while importing, returning a retry is safe: source listing IDs are deterministic.
            reply(res, 503, "retry");
            return;
        }
        reply(res, 200, "ok");
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

