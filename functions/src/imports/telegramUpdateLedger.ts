export type TelegramUpdateClaimStatus = "claimed" | "processed" | "busy";

export interface TelegramUpdateLedger {
    claim(updateId: number, now: number, claimToken: string): Promise<TelegramUpdateClaimStatus>;
    finish(updateId: number, claimToken: string, now: number): Promise<boolean>;
    release(updateId: number, claimToken: string): Promise<void>;
}

const UPDATE_LEASE_MS = 90_000;
const UPDATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Firestore transaction ledger for Telegram's at-least-once webhook delivery. */
export class FirestoreTelegramUpdateLedger implements TelegramUpdateLedger {
    constructor(private readonly db: FirebaseFirestore.Firestore) {}

    async claim(updateId: number, now: number, claimToken: string): Promise<TelegramUpdateClaimStatus> {
        const ref = this.db.collection("telegramWebhookUpdates").doc(String(updateId));
        return this.db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            const leaseUntil = snapshot.get("leaseUntil");
            if (snapshot.get("status") === "processed") return "processed";
            if (snapshot.get("status") === "processing" && typeof leaseUntil === "number" && leaseUntil > now) {
                return "busy";
            }
            transaction.set(ref, {
                status: "processing",
                claimToken,
                leaseUntil: now + UPDATE_LEASE_MS,
                expireAt: new Date(now + UPDATE_RETENTION_MS),
                updatedAt: now,
            });
            return "claimed";
        });
    }

    async finish(updateId: number, claimToken: string, now: number): Promise<boolean> {
        const ref = this.db.collection("telegramWebhookUpdates").doc(String(updateId));
        return this.db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (snapshot.get("status") !== "processing" || snapshot.get("claimToken") !== claimToken) return false;
            transaction.set(ref, {
                status: "processed",
                processedAt: now,
                expireAt: new Date(now + UPDATE_RETENTION_MS),
            });
            return true;
        });
    }

    async release(updateId: number, claimToken: string): Promise<void> {
        const ref = this.db.collection("telegramWebhookUpdates").doc(String(updateId));
        await this.db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            if (snapshot.get("status") === "processing" && snapshot.get("claimToken") === claimToken) {
                transaction.delete(ref);
            }
        });
    }
}
