import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();
const DAY_MS = 24 * 60 * 60 * 1000;
const HARD_DELETE_AFTER_MS = 90 * DAY_MS;
const QUERY_PAGE_SIZE = 200;
const DELETE_BATCH_SIZE = 400;

const AD_DELETE_STATUSES = ["expired", "deleted", "removed", "hidden"] as const;
const AUCTION_DELETE_STATUSES = ["expired", "removed", "hidden", "ended"] as const;

type ListingCollection = "ads" | "auctions";
type ListingCandidate = {
    id: string;
    ref: FirebaseFirestore.DocumentReference;
    data: FirebaseFirestore.DocumentData;
};

type CleanupStats = {
    collection: ListingCollection;
    found: number;
    deleted: number;
    skipped: number;
    errors: number;
    relatedBidTreesDeleted: number;
    relatedBidTreeErrors: number;
    imageUrlsFound: number;
    imagesDeleted: number;
    imagesSkipped: number;
    imageDeleteErrors: number;
};

export const hardDeleteOldListings = onSchedule(
    {
        schedule: "every day 04:30",
        timeZone: "Europe/Warsaw",
        timeoutSeconds: 540,
        memory: "512MiB",
        maxInstances: 1,
    },
    async () => {
        const now = Date.now();
        const cutoff = now - HARD_DELETE_AFTER_MS;

        const adsStats = await cleanCollection(
            "ads",
            AD_DELETE_STATUSES,
            cutoff,
            now,
            getAdRetentionDate
        );
        const auctionsStats = await cleanCollection(
            "auctions",
            AUCTION_DELETE_STATUSES,
            cutoff,
            now,
            getAuctionRetentionDate
        );

        console.log("hardDeleteOldListings completed", {
            cutoff: new Date(cutoff).toISOString(),
            ads: adsStats,
            auctions: auctionsStats,
        });
    }
);

async function cleanCollection(
    collectionName: ListingCollection,
    statuses: readonly string[],
    cutoff: number,
    now: number,
    getRetentionDate: (
        data: FirebaseFirestore.DocumentData,
        status: string,
        now: number
    ) => number | null
): Promise<CleanupStats> {
    const stats = createStats(collectionName);

    for (const status of statuses) {
        let lastDocumentId: string | null = null;

        while (true) {
            let listingsQuery = db
                .collection(collectionName)
                .where("status", "==", status)
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(QUERY_PAGE_SIZE);

            if (lastDocumentId) {
                listingsQuery = listingsQuery.startAfter(lastDocumentId);
            }

            const snapshot = await listingsQuery.get();
            if (snapshot.empty) break;

            stats.found += snapshot.size;
            const candidates: ListingCandidate[] = [];

            for (const listingDoc of snapshot.docs) {
                const data = listingDoc.data();
                const retentionDate = getRetentionDate(data, status, now);

                if (!retentionDate || retentionDate > cutoff) {
                    stats.skipped++;
                    continue;
                }

                candidates.push({
                    id: listingDoc.id,
                    ref: listingDoc.ref,
                    data,
                });
            }

            await deleteCandidates(collectionName, candidates, stats);

            lastDocumentId = snapshot.docs[snapshot.docs.length - 1].id;
            if (snapshot.size < QUERY_PAGE_SIZE) break;
        }
    }

    console.log("hardDeleteOldListings collection completed", stats);
    return stats;
}

async function deleteCandidates(
    collectionName: ListingCollection,
    candidates: ListingCandidate[],
    stats: CleanupStats
): Promise<void> {
    const readyForDelete: ListingCandidate[] = [];

    for (const candidate of candidates) {
        if (collectionName === "auctions") {
            try {
                // Firestore does not cascade parent deletion to the stored bid tree.
                await db.recursiveDelete(db.collection("auctionBids").doc(candidate.id));
                stats.relatedBidTreesDeleted++;
            } catch (error) {
                stats.relatedBidTreeErrors++;
                stats.errors++;
                console.error("Failed to delete auction bid tree", {
                    auctionId: candidate.id,
                    error: getErrorMessage(error),
                });
                continue;
            }
        }

        readyForDelete.push(candidate);
    }

    for (let offset = 0; offset < readyForDelete.length; offset += DELETE_BATCH_SIZE) {
        const chunk = readyForDelete.slice(offset, offset + DELETE_BATCH_SIZE);
        const deletedCandidates = await deleteDocumentChunk(collectionName, chunk, stats);

        for (const candidate of deletedCandidates) {
            await deleteListingImages(collectionName, candidate, stats);
        }
    }
}

async function deleteDocumentChunk(
    collectionName: ListingCollection,
    candidates: ListingCandidate[],
    stats: CleanupStats
): Promise<ListingCandidate[]> {
    if (candidates.length === 0) return [];

    const batch = db.batch();
    candidates.forEach(candidate => batch.delete(candidate.ref));

    try {
        await batch.commit();
        stats.deleted += candidates.length;
        return candidates;
    } catch (error) {
        console.error("Listing delete batch failed; retrying documents individually", {
            collection: collectionName,
            count: candidates.length,
            error: getErrorMessage(error),
        });
    }

    const deletedCandidates: ListingCandidate[] = [];

    for (const candidate of candidates) {
        try {
            await candidate.ref.delete();
            stats.deleted++;
            deletedCandidates.push(candidate);
        } catch (error) {
            stats.errors++;
            console.error("Failed to delete listing document", {
                collection: collectionName,
                listingId: candidate.id,
                error: getErrorMessage(error),
            });
        }
    }

    return deletedCandidates;
}

async function deleteListingImages(
    collectionName: ListingCollection,
    candidate: ListingCandidate,
    stats: CleanupStats
): Promise<void> {
    const imageUrls = getImageUrls(candidate.data);
    stats.imageUrlsFound += imageUrls.length;

    for (const imageUrl of imageUrls) {
        try {
            const storageBucket = admin.storage().bucket();
            const objectPath = getFirebaseStorageObjectPath(imageUrl, storageBucket.name);
            const expectedPrefix = `${collectionName}/`;

            if (!objectPath || !objectPath.startsWith(expectedPrefix)) {
                stats.imagesSkipped++;
                continue;
            }

            await storageBucket.file(objectPath).delete();
            stats.imagesDeleted++;
        } catch (error) {
            if (isStorageObjectMissing(error)) {
                stats.imagesSkipped++;
                continue;
            }

            stats.imageDeleteErrors++;
            console.error("Failed to delete listing image", {
                collection: collectionName,
                listingId: candidate.id,
                imageUrl: sanitizeUrlForLog(imageUrl),
                error: getErrorMessage(error),
            });
        }
    }
}

function getAdRetentionDate(
    data: FirebaseFirestore.DocumentData,
    status: string
): number | null {
    const expiredAt = toMillis(data.expiredAt);
    if (expiredAt) return expiredAt;

    if (status === "deleted") {
        const deletedAt = toMillis(data.deletedAt);
        if (deletedAt) return deletedAt;
    }
    if (status === "removed") {
        const removedAt = toMillis(data.removedAt) ?? toMillis(data.moderatedAt);
        if (removedAt) return removedAt;
    }
    if (status === "hidden") {
        const hiddenAt = toMillis(data.hiddenAt) ?? toMillis(data.moderatedAt);
        if (hiddenAt) return hiddenAt;
    }

    // This fallback is reached only for the explicitly allowed non-active statuses.
    return toMillis(data.createdAt);
}

function getAuctionRetentionDate(
    data: FirebaseFirestore.DocumentData,
    _status: string,
    now: number
): number | null {
    const endedAt = toMillis(data.endedAt);
    if (endedAt) return endedAt;

    const expiredAt = toMillis(data.expiredAt);
    if (expiredAt) return expiredAt;

    const endsAt = toMillis(data.endsAt);
    return endsAt && endsAt <= now ? endsAt : null;
}

function getImageUrls(data: FirebaseFirestore.DocumentData): string[] {
    const values = Array.isArray(data.images)
        ? data.images.filter((value): value is string => typeof value === "string")
        : [];

    if (typeof data.image === "string") {
        values.push(data.image);
    }

    return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

export function getFirebaseStorageObjectPath(
    rawUrl: string,
    expectedBucket: string
): string | null {
    let url: URL;

    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }

    let bucketName = "";
    let encodedObjectPath = "";

    if (url.protocol === "gs:") {
        bucketName = url.hostname;
        encodedObjectPath = url.pathname.replace(/^\/+/, "");
    } else if (url.protocol === "https:" && url.hostname === "firebasestorage.googleapis.com") {
        const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
        if (!match) return null;
        bucketName = decodeSafely(match[1]);
        encodedObjectPath = match[2];
    } else if (url.protocol === "https:" && url.hostname === "storage.googleapis.com") {
        const match = url.pathname.match(/^\/([^/]+)\/(.+)$/);
        if (!match) return null;
        bucketName = decodeSafely(match[1]);
        encodedObjectPath = match[2];
    } else if (
        url.protocol === "https:" &&
        url.hostname === `${expectedBucket}.storage.googleapis.com`
    ) {
        bucketName = expectedBucket;
        encodedObjectPath = url.pathname.replace(/^\/+/, "");
    } else {
        return null;
    }

    if (bucketName !== expectedBucket) return null;

    const objectPath = decodeSafely(encodedObjectPath).replace(/^\/+/, "");
    return objectPath && !objectPath.includes("\0") ? objectPath : null;
}

function decodeSafely(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function sanitizeUrlForLog(rawUrl: string): string {
    try {
        const url = new URL(rawUrl);
        url.search = "";
        url.hash = "";
        return url.toString();
    } catch {
        return "[invalid-url]";
    }
}

function toMillis(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value === "object" && "toMillis" in value) {
        const timestamp = value as { toMillis?: () => number };
        const millis = timestamp.toMillis?.();
        return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
    }

    return null;
}

function createStats(collection: ListingCollection): CleanupStats {
    return {
        collection,
        found: 0,
        deleted: 0,
        skipped: 0,
        errors: 0,
        relatedBidTreesDeleted: 0,
        relatedBidTreeErrors: 0,
        imageUrlsFound: 0,
        imagesDeleted: 0,
        imagesSkipped: 0,
        imageDeleteErrors: 0,
    };
}

function isStorageObjectMissing(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const code = (error as { code?: number | string }).code;
    return code === 404 || code === "404";
}

function getErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.length > 1000 ? `${message.slice(0, 1000)}...` : message;
}
