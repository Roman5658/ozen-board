import type { Firestore } from "firebase-admin/firestore";
import { createExternalListingDocumentId, type ExternalListing } from "./externalListings";
import type { ExternalListingImportRepository, ImportRunResult } from "./runExternalListingImport";

const LISTINGS = "externalAds";
const RUNS = "externalImportRuns";
const LOCKS = "externalImportLocks";
const DAILY_LIMITS = "externalImportDailyLimits";

export type ExternalListingDailyLimit = {
    quotaId: string;
    maxNewListingsPerUtcDay: number;
};

function currentTime(now: number): number {
    return Math.max(now, Date.now());
}

export class FirestoreExternalListingsRepository implements ExternalListingImportRepository {
    constructor(private readonly db: Firestore, private readonly dailyLimit?: ExternalListingDailyLimit) {
        if (dailyLimit && (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(dailyLimit.quotaId) ||
            !Number.isSafeInteger(dailyLimit.maxNewListingsPerUtcDay) || dailyLimit.maxNewListingsPerUtcDay < 1)) {
            throw new Error("invalid-external-listing-daily-limit");
        }
    }

    async acquireLock(sourceId: string, runId: string, now: number, lockMs: number): Promise<boolean> {
        const lockRef = this.db.collection(LOCKS).doc(sourceId);
        return this.db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(lockRef);
            const lockedUntil = snapshot.get("lockedUntil");
            const checkedAt = currentTime(now);
            if (typeof lockedUntil === "number" && lockedUntil > checkedAt) return false;
            transaction.set(lockRef, { runId, lockedUntil: checkedAt + lockMs, updatedAt: checkedAt });
            return true;
        });
    }

    async renewLock(sourceId: string, runId: string, now: number, lockMs: number): Promise<boolean> {
        const lockRef = this.db.collection(LOCKS).doc(sourceId);
        return this.db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(lockRef);
            const lockedUntil = snapshot.get("lockedUntil");
            const checkedAt = currentTime(now);
            if (snapshot.get("runId") !== runId || typeof lockedUntil !== "number" || lockedUntil <= checkedAt) {
                return false;
            }
            transaction.update(lockRef, { lockedUntil: checkedAt + lockMs, updatedAt: checkedAt });
            return true;
        });
    }

    async startRun(runId: string, sourceId: string, startedAt: number): Promise<void> {
        await this.db.collection(RUNS).doc(runId).set({
            runId,
            sourceId,
            status: "running",
            startedAt,
            pages: 0,
            received: 0,
            created: 0,
            updated: 0,
            skipped: 0,
            duplicates: 0,
            stale: 0,
        });
    }

    async upsertListing(listing: ExternalListing, runId: string, now: number): Promise<"created" | "updated" | "duplicate" | "limited"> {
        const ref = this.db.collection(LISTINGS).doc(createExternalListingDocumentId(listing.sourceId, listing.sourceListingId));
        const lockRef = this.db.collection(LOCKS).doc(listing.sourceId);
        const sameUrl = await this.db.collection(LISTINGS)
            .where("sourceId", "==", listing.sourceId)
            .where("normalizedUrlHash", "==", listing.normalizedUrlHash)
            .limit(2)
            .get();
        let duplicateDocument = sameUrl.docs.find((document) => document.id !== ref.id);

        // Older records predate normalizedUrlHash; retain exact-URL de-duplication for them.
        if (!duplicateDocument) {
            const legacySameUrl = await this.db.collection(LISTINGS)
                .where("sourceId", "==", listing.sourceId)
                .where("originalUrl", "==", listing.originalUrl)
                .limit(2)
                .get();
            duplicateDocument = legacySameUrl.docs.find((document) => document.id !== ref.id);
        }

        return this.db.runTransaction(async (transaction) => {
            const lockSnapshot = await transaction.get(lockRef);
            const snapshot = await transaction.get(ref);
            const lockedUntil = lockSnapshot.get("lockedUntil");
            if (lockSnapshot.get("runId") !== runId || typeof lockedUntil !== "number" || lockedUntil <= currentTime(now)) {
                throw new Error("source-lock-lost");
            }
            if (duplicateDocument) return "duplicate";
            let quotaRef: FirebaseFirestore.DocumentReference | undefined;
            let quotaSnapshot: FirebaseFirestore.DocumentSnapshot | undefined;
            let quotaDay: string | undefined;
            if (this.dailyLimit && !snapshot.exists && listing.sourceId.startsWith("telegram_")) {
                quotaDay = new Date(currentTime(now)).toISOString().slice(0, 10);
                quotaRef = this.db.collection(DAILY_LIMITS).doc(`${this.dailyLimit.quotaId}_${quotaDay}`);
                quotaSnapshot = await transaction.get(quotaRef);
                const storedDay = quotaSnapshot.get("day");
                const storedCount = quotaSnapshot.get("count");
                if (storedDay === quotaDay && (!Number.isSafeInteger(storedCount) || (storedCount as number) < 0)) {
                    return "limited";
                }
                const count = storedDay === quotaDay ? storedCount as number : 0;
                if (count >= this.dailyLimit.maxNewListingsPerUtcDay) return "limited";
            }
            const existingImportedAt = snapshot.get("importedAt");
            transaction.set(ref, {
                ...listing,
                importedAt: typeof existingImportedAt === "number" ? existingImportedAt : listing.importedAt,
                lastSuccessfulSyncAt: listing.lastSuccessfulSyncAt,
                lastSeenAt: listing.lastSeenAt,
                updatedAt: listing.lastSuccessfulSyncAt,
                // A deliberate admin hide is sticky across feed refreshes.
                status: snapshot.get("status") === "hidden" ? "hidden" : listing.status,
            });
            if (quotaRef && quotaSnapshot && quotaDay && this.dailyLimit) {
                const previousDay = quotaSnapshot.get("day");
                const previousCount = previousDay === quotaDay ? quotaSnapshot.get("count") as number : 0;
                const nextDay = new Date(`${quotaDay}T00:00:00.000Z`);
                nextDay.setUTCDate(nextDay.getUTCDate() + 35);
                transaction.set(quotaRef, {
                    day: quotaDay,
                    count: previousCount + 1,
                    updatedAt: currentTime(now),
                    expireAt: nextDay,
                });
            }
            return snapshot.exists ? "updated" : "created";
        });
    }

    async markMissingAsStale(
        sourceId: string,
        seenAt: number,
        maxRecords: number,
        runId: string,
        now: number,
    ): Promise<{ marked: number; scanLimited: boolean }> {
        const pageSize = 200;
        const maxBatchWrites = 450;
        const maxScanned = Math.max(1, Math.min(maxRecords, 1_000));
        const baseQuery = this.db.collection(LISTINGS)
            .where("sourceId", "==", sourceId)
            .orderBy("__name__");
        let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
        let scanned = 0;
        const staleDocuments: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        let scanLimited = false;

        while (scanned < maxScanned && staleDocuments.length < maxBatchWrites) {
            const pageLimit = Math.min(pageSize, maxScanned - scanned);
            let pageQuery = baseQuery.limit(pageLimit);
            if (cursor) pageQuery = pageQuery.startAfter(cursor);
            const page = await pageQuery.get();
            if (page.empty) break;

            for (const document of page.docs) {
                const data = document.data();
                scanned++;
                const lastSeenAt = data.lastSeenAt;
                if ((data.status === "active" || data.status === "review") &&
                    (typeof lastSeenAt !== "number" || lastSeenAt < seenAt)) {
                    staleDocuments.push(document);
                    if (staleDocuments.length >= maxBatchWrites) {
                        scanLimited = true;
                        break;
                    }
                }
            }
            cursor = page.docs[page.docs.length - 1];
            if (staleDocuments.length >= maxBatchWrites) break;
            if (page.size < pageLimit) break;
            if (scanned >= maxScanned) scanLimited = true;
        }

        // Recheck the lease and candidates atomically so a run that lost its lock cannot stale data.
        if (staleDocuments.length) {
            const lockRef = this.db.collection(LOCKS).doc(sourceId);
            const marked = await this.db.runTransaction(async (transaction) => {
                const lockSnapshot = await transaction.get(lockRef);
                const lockedUntil = lockSnapshot.get("lockedUntil");
                const checkedAt = currentTime(now);
                if (lockSnapshot.get("runId") !== runId || typeof lockedUntil !== "number" || lockedUntil <= checkedAt) {
                    throw new Error("source-lock-lost");
                }

                const currentSnapshots = await Promise.all(staleDocuments.map((document) => transaction.get(document.ref)));
                let updated = 0;
                for (const snapshot of currentSnapshots) {
                    const data = snapshot.data();
                    if (snapshot.exists && data?.sourceId === sourceId &&
                        (data.status === "active" || data.status === "review") &&
                        (typeof data.lastSeenAt !== "number" || data.lastSeenAt < seenAt)) {
                        transaction.update(snapshot.ref, { status: "stale", staleAt: seenAt, updatedAt: checkedAt });
                        updated++;
                    }
                }
                return updated;
            });
            return { marked, scanLimited };
        }

        return { marked: 0, scanLimited };
    }

    async finishRun(result: ImportRunResult): Promise<void> {
        await this.db.collection(RUNS).doc(result.runId).set({ ...result }, { merge: true });
    }

    async releaseLock(sourceId: string, runId: string): Promise<void> {
        const lockRef = this.db.collection(LOCKS).doc(sourceId);
        await this.db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(lockRef);
            if (snapshot.get("runId") === runId) transaction.delete(lockRef);
        });
    }
}
