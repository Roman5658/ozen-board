import type { Firestore } from "firebase-admin/firestore";

const WINDOW_MS = 60_000;
const RATE_LIMIT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

export interface TelegramUpdateRateLimiter {
    allow(sourceId: string, now: number, maxPerMinute: number): Promise<boolean>;
}

/** Shared Firestore fixed-window limiter; each configured chat has an independent cap. */
export class FirestoreTelegramUpdateRateLimiter implements TelegramUpdateRateLimiter {
    constructor(private readonly db: Firestore) {}

    async allow(sourceId: string, now: number, maxPerMinute: number): Promise<boolean> {
        if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(sourceId) || !Number.isFinite(now) || now <= 0 ||
            !Number.isSafeInteger(maxPerMinute) || maxPerMinute < 1 || maxPerMinute > 60) {
            throw new Error("invalid-telegram-rate-limit-input");
        }
        const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
        const ref = this.db.collection("telegramWebhookRateLimits").doc(sourceId);
        return this.db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            const storedCount = snapshot.get("count");
            const sameWindow = snapshot.get("windowStart") === windowStart;
            if (sameWindow && (!Number.isSafeInteger(storedCount) || (storedCount as number) < 0)) return false;
            const count = sameWindow ? storedCount as number : 0;
            if (count >= maxPerMinute) return false;
            transaction.set(ref, {
                windowStart,
                count: count + 1,
                updatedAt: now,
                expireAt: new Date(windowStart + RATE_LIMIT_RETENTION_MS),
            });
            return true;
        });
    }
}
