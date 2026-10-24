import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { requireTelegramAdmin, type TelegramAdminAuth } from "./telegramWebhookAdmin";

export const TELEGRAM_DEACTIVATION_REASONS = ["original_removed", "original_invalid"] as const;
export type TelegramDeactivationReason = typeof TELEGRAM_DEACTIVATION_REASONS[number];

const TELEGRAM_SOURCE_ID_PATTERN = /^telegram_[a-f0-9]{20}$/;

/** Manually hides a verified Telegram import without changing records from other import sources. */
export async function deactivateTelegramListing(
    db: Firestore,
    externalAdId: string,
    reason: TelegramDeactivationReason,
): Promise<{ deactivated: true; alreadyHidden?: true }> {
    if (typeof externalAdId !== "string" || !/^[A-Za-z0-9_-]{1,180}$/.test(externalAdId)) {
        throw new HttpsError("invalid-argument", "Nieprawidłowy identyfikator ogłoszenia.");
    }
    if (!TELEGRAM_DEACTIVATION_REASONS.includes(reason)) {
        throw new HttpsError("invalid-argument", "Nieprawidłowy powód dezaktywacji.");
    }

    const ref = db.collection("externalAds").doc(externalAdId);
    const hiddenAt = Date.now();
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new HttpsError("not-found", "Ogłoszenie zewnętrzne nie istnieje.");
        const data = snapshot.data() ?? {};
        if (data.isExternal !== true || typeof data.sourceId !== "string" || !TELEGRAM_SOURCE_ID_PATTERN.test(data.sourceId)) {
            throw new HttpsError("failed-precondition", "Można dezaktywować wyłącznie ogłoszenia importowane z Telegrama.");
        }
        if (data.status === "hidden") return { deactivated: true, alreadyHidden: true };

        transaction.update(ref, {
            status: "hidden",
            hiddenAt,
            hiddenReason: reason,
            updatedAt: hiddenAt,
        });
        return { deactivated: true };
    });
}

/** Callable entry handler: authorizes before validating or accessing the target document. */
export async function deactivateTelegramListingAsAdmin(
    auth: TelegramAdminAuth,
    db: Firestore,
    externalAdId: unknown,
    reason: unknown,
): Promise<{ deactivated: true; alreadyHidden?: true }> {
    requireTelegramAdmin(auth);
    if (typeof reason !== "string" || !TELEGRAM_DEACTIVATION_REASONS.includes(reason as TelegramDeactivationReason)) {
        throw new HttpsError("invalid-argument", "Укажите допустимую причину деактивации.");
    }
    return deactivateTelegramListing(db, typeof externalAdId === "string" ? externalAdId : "", reason as TelegramDeactivationReason);
}
