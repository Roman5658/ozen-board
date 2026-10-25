import { createHash, randomUUID } from "node:crypto";
import * as admin from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {buildTrustedTelegramAdData } from "../listings/createAd";
import type { ParsedTelegramAd } from "./telegramListingsAdapter";

const IMPORT_RECORDS = "telegramImportRecords";
const DAILY_LIMITS = "externalImportDailyLimits";
const DAILY_LIMIT = 20;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 10;

type TelegramPhotoStorage = {
    save(path: string, bytes: Buffer, contentType: string, downloadToken: string): Promise<string>;
    delete(paths: string[]): Promise<void>;
};

export type StoredTelegramImages = { urls: string[]; paths: string[] };

function getSafeTelegramImagePaths(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((path): path is string =>
        typeof path === "string" &&
        /^telegram-imports\/[a-f0-9]{64}\/[a-f0-9]{64}\/\d+\.(?:jpg|png|webp)$/.test(path)
    );
}

export function getUnreferencedTelegramImagePaths(candidate: unknown, retainedCandidate?: unknown): string[] {
    const retainedCandidates = Array.isArray(retainedCandidate) ? retainedCandidate : [retainedCandidate];
    const retained = new Set(retainedCandidates.flatMap((item) =>
        item && typeof item === "object"
            ? getSafeTelegramImagePaths((item as Record<string, unknown>).imagePaths)
            : [],
    ));
    return candidate && typeof candidate === "object"
        ? getSafeTelegramImagePaths((candidate as Record<string, unknown>).imagePaths).filter((path) => !retained.has(path))
        : [];
}

async function cleanupTelegramImages(
    paths: string[],
    deletePhotos: (paths: string[]) => Promise<void>,
): Promise<void> {
    if (!paths.length) return;
    try {
        await deletePhotos(paths);
    } catch {
        console.error("Telegram media cleanup deferred", { reason: "moderation_cleanup_failed" });
    }
}

function safeImageType(bytes: Buffer): { contentType: string; extension: string } | null {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return { contentType: "image/jpeg", extension: "jpg" };
    }
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        return { contentType: "image/png", extension: "png" };
    }
    if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
        return { contentType: "image/webp", extension: "webp" };
    }
    return null;
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
    const headerSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(headerSize) && headerSize > maxBytes) throw new Error("telegram-image-too-large");
    if (!response.body) throw new Error("telegram-image-empty");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new Error("telegram-image-too-large");
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function defaultTelegramPhotoStorage(): TelegramPhotoStorage {
    const bucket = admin.storage().bucket();
    return {
        async save(path, bytes, contentType, downloadToken) {
            await bucket.file(path).save(bytes, {
                resumable: false,
                metadata: {
                    contentType,
                    metadata: { firebaseStorageDownloadTokens: downloadToken },
                },
            });
            return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
        },
        async delete(paths) {
            await Promise.all(paths.map((path) => bucket.file(path).delete({ ignoreNotFound: true }).catch(() => undefined)));
        },
    };
}

/** Downloads only Telegram photo file IDs, validates bytes and stores public ad images in Storage. */
export async function storeTelegramPhotos(
    parsed: ParsedTelegramAd,
    botToken: string,
    options: { fetchImplementation?: typeof fetch; storage?: TelegramPhotoStorage } = {},
): Promise<StoredTelegramImages> {
    if (!parsed.photoFileIds.length) return { urls: [], paths: [] };
    if (parsed.photoFileIds.length > MAX_IMAGES || !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
        throw new Error("telegram-media-configuration-invalid");
    }
    const fetcher = options.fetchImplementation ?? fetch;
    const storage = options.storage ?? defaultTelegramPhotoStorage();
    const importKey = createTelegramImportKey(parsed.sourceId, parsed.chatId, parsed.messageId);
    const urls: string[] = [];
    const paths: string[] = [];
    try {
        for (const [index, fileId] of parsed.photoFileIds.entries()) {
            const apiResponse = await fetcher(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`, {
                method: "GET",
                redirect: "error",
                signal: AbortSignal.timeout(10_000),
            });
            const apiJson: unknown = await apiResponse.json().catch(() => null);
            if (!apiResponse.ok || !apiJson || typeof apiJson !== "object" ||
                (apiJson as { ok?: unknown }).ok !== true) {
                throw new Error("telegram-file-lookup-failed");
            }
            const filePath = (apiJson as { result?: { file_path?: unknown } }).result?.file_path;
            if (typeof filePath !== "string" || filePath.length > 512 || filePath.includes("..") || filePath.startsWith("/")) {
                throw new Error("telegram-file-path-invalid");
            }
            const fileResponse = await fetcher(`https://api.telegram.org/file/bot${botToken}/${filePath}`, {
                method: "GET",
                redirect: "error",
                signal: AbortSignal.timeout(15_000),
            });
            if (!fileResponse.ok) throw new Error("telegram-file-download-failed");
            const bytes = await readLimited(fileResponse, MAX_IMAGE_BYTES);
            const image = safeImageType(bytes);
            if (!image) throw new Error("telegram-image-type-unsupported");
            const path = `telegram-imports/${importKey}/${parsed.contentHash}/${index}.${image.extension}`;
            const url = await storage.save(path, bytes, image.contentType, randomUUID());
            urls.push(url);
            paths.push(path);
        }
        return { urls, paths };
    } catch (error) {
        await storage.delete(paths);
        throw error;
    }
}

/** Stores bytes supplied by the authenticated Telethon collector after validating image signatures. */
export async function storeTelegramPhotoBytes(
    parsed: ParsedTelegramAd,
    photoBytes: Buffer[],
    options: { storage?: TelegramPhotoStorage } = {},
): Promise<StoredTelegramImages> {
    if (!parsed.photoFileIds.length) return { urls: [], paths: [] };
    if (photoBytes.length !== parsed.photoFileIds.length || photoBytes.length > MAX_IMAGES) {
        throw new Error("telegram-image-payload-invalid");
    }
    const storage = options.storage ?? defaultTelegramPhotoStorage();
    const importKey = createTelegramImportKey(parsed.sourceId, parsed.chatId, parsed.messageId);
    const urls: string[] = [];
    const paths: string[] = [];
    try {
        for (const [index, bytes] of photoBytes.entries()) {
            if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
                throw new Error("telegram-image-too-large");
            }
            const image = safeImageType(bytes);
            if (!image) throw new Error("telegram-image-type-unsupported");
            const path = `telegram-imports/${importKey}/${parsed.contentHash}/${index}.${image.extension}`;
            const url = await storage.save(path, bytes, image.contentType, randomUUID());
            urls.push(url);
            paths.push(path);
        }
        return { urls, paths };
    } catch (error) {
        await storage.delete(paths);
        throw error;
    }
}

export async function deleteTelegramPhotos(paths: string[]): Promise<void> {
    if (!paths.length) return;
    await defaultTelegramPhotoStorage().delete(paths);
}

export function createTelegramImportKey(sourceId: string, chatId: string, messageId: number): string {
    return createHash("sha256").update(`${sourceId}\0${chatId}\0${messageId}`).digest("hex");
}

function createTelegramListingDedupFingerprint(parsed: ParsedTelegramAd): string {
    const normalize = (value: unknown) => typeof value === "string"
        ? value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()
        : "";
    return createHash("sha256").update(JSON.stringify({
        title: normalize(parsed.title),
        description: normalize(parsed.description),
        category: normalize(parsed.catalogCategory || parsed.category),
        subcategory: normalize(parsed.catalogSubcategory),
        priceType: normalize(parsed.priceType),
        price: normalize(parsed.price),
        city: normalize(parsed.city),
        voivodeship: normalize(parsed.voivodeship),
    })).digest("hex");
}

function createTelegramTransportIndependentFingerprint(
    candidate: Record<string, unknown>,
    permittedFields: unknown,
): string {
    const normalize = (value: unknown) => typeof value === "string"
        ? value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()
        : "";
    const fields = Array.isArray(permittedFields)
        ? permittedFields.filter((field): field is string => typeof field === "string").sort()
        : [];
    return createHash("sha256").update(JSON.stringify({
        title: normalize(candidate.title),
        description: normalize(candidate.description),
        category: normalize(candidate.category),
        catalogCategory: normalize(candidate.catalogCategory),
        catalogSubcategory: normalize(candidate.catalogSubcategory),
        priceType: normalize(candidate.priceType),
        price: normalize(candidate.price),
        exchangeDetails: normalize(candidate.exchangeDetails),
        city: normalize(candidate.city),
        voivodeship: normalize(candidate.voivodeship),
        sellerContact: normalize(candidate.sellerContact),
        permittedFields: fields,
    })).digest("hex");
}

function createTelegramParsedTransportFingerprint(parsed: ParsedTelegramAd): string {
    return createTelegramTransportIndependentFingerprint(parsed as unknown as Record<string, unknown>, parsed.permittedFields);
}

function getStoredTransportFingerprint(record: FirebaseFirestore.DocumentData, candidate: unknown): string | undefined {
    if (typeof record.transportIndependentFingerprint === "string") return record.transportIndependentFingerprint;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
    return createTelegramTransportIndependentFingerprint(
        candidate as Record<string, unknown>,
        record.rightsFields,
    );
}

export async function inspectTelegramImport(
    db: Firestore,
    parsed: ParsedTelegramAd,
    isEdited: boolean,
): Promise<"continue" | "duplicate" | "sticky_terminal"> {
    const key = createTelegramImportKey(parsed.sourceId, parsed.chatId, parsed.messageId);
    const snapshot = await db.collection(IMPORT_RECORDS).doc(key).get();
    if (!snapshot.exists) return "continue";
    const data = snapshot.data() ?? {};
    if (data.state === "rejected" || data.state === "deactivated") return "sticky_terminal";
    if (Array.isArray(data.rejectedRevisionParsedHashes) && data.rejectedRevisionParsedHashes.includes(parsed.contentHash)) return "duplicate";
    if (data.pendingRevisionParsedContentHash === parsed.contentHash) return "duplicate";
    if (!isEdited && getStoredTransportFingerprint(data, data.candidate) === createTelegramParsedTransportFingerprint(parsed)) return "duplicate";
    if (!isEdited && data.parsedContentHash === parsed.contentHash) return "duplicate";
    return "continue";
}

function toSafeCandidate(parsed: ParsedTelegramAd, images: StoredTelegramImages) {
    return {
        title: parsed.title,
        description: parsed.description,
        category: parsed.category ?? "",
        catalogCategory: parsed.catalogCategory ?? "",
        catalogSubcategory: parsed.catalogSubcategory ?? "",
        priceType: parsed.priceType ?? "",
        price: parsed.price ?? "",
        exchangeDetails: parsed.exchangeDetails ?? "",
        city: parsed.city ?? "",
        voivodeship: parsed.voivodeship ?? "",
        sellerContact: parsed.sellerContact ?? "",
        images: images.urls,
        imagePaths: images.paths,
    };
}

function buildPublicAd(candidate: ReturnType<typeof toSafeCandidate>, parsed: ParsedTelegramAd, now: number) {
    const built = buildTrustedTelegramAdData({
        title: candidate.title,
        description: candidate.description,
        category: candidate.category,
        catalogCategory: candidate.catalogCategory || undefined,
        catalogSubcategory: candidate.catalogSubcategory || undefined,
        voivodeship: candidate.voivodeship,
        city: candidate.city,
        priceType: candidate.priceType,
        price: candidate.price,
        exchangeDetails: candidate.exchangeDetails,
        images: candidate.images,
        sellerContact: candidate.sellerContact,
    }, now);
    return {
        ...built,
        sourceUrl: parsed.sourceUrl,
        sourceName: parsed.sourceName,
        sourcePublishedAt: parsed.publishedAt,
        importedAt: now,
        sourceUpdatedAt: now,
    };
}

export type TelegramIngestResult = "created" | "review" | "updated_review" | "duplicate" | "sticky_terminal" | "edited_needs_review" | "daily_limit";

/** Stores one Telegram message idempotently. Published ad edits are staged for review. */
export async function ingestTelegramAd(
    db: Firestore,
    parsed: ParsedTelegramAd,
    images: StoredTelegramImages,
    isEdited: boolean,
    now = Date.now(),
    options: { deletePhotos?: (paths: string[]) => Promise<void> } = {},
): Promise<TelegramIngestResult> {
    const key = createTelegramImportKey(parsed.sourceId, parsed.chatId, parsed.messageId);
    const recordRef = db.collection(IMPORT_RECORDS).doc(key);
    const adRef = db.collection("ads").doc(`telegram_${key}`);
    const duplicateFingerprint = createTelegramListingDedupFingerprint(parsed);
    const transportIndependentFingerprint = createTelegramParsedTransportFingerprint(parsed);
    const duplicateMarkerRef = db.collection(IMPORT_RECORDS).doc(`dedup_${duplicateFingerprint}`);
    const candidate = toSafeCandidate(parsed, images);
    const reasons = [...parsed.reviewReasons];
    let obsoleteImagePaths: string[] = [];
    let publicData: ReturnType<typeof buildPublicAd> | null = null;
    if (parsed.autoPublishEligible) {
        try {
            publicData = buildPublicAd(candidate, parsed, now);
        } catch {
            reasons.push("ad_validation_failed");
        }
    }
    const contentHash = createHash("sha256").update(JSON.stringify({
        parsed: parsed.contentHash,
        images: images.paths,
        candidate,
    })).digest("hex");

    const result = await db.runTransaction(async (transaction) => {
        const recordSnap = await transaction.get(recordRef);
        const current = recordSnap.exists ? recordSnap.data() : undefined;
        const adSnap = await transaction.get(adRef);
        const duplicateMarker = await transaction.get(duplicateMarkerRef);
        const possibleDuplicates = duplicateMarker.exists
            ? undefined
            : await transaction.get(db.collection(IMPORT_RECORDS).where("duplicateFingerprint", "==", duplicateFingerprint).limit(10));
        const legacyDuplicate = possibleDuplicates?.docs.find((document) =>
            document.id !== key && ["pending_review", "published"].includes(String(document.get("state"))),
        );
        const markerOwnerId = duplicateMarker.get("recordId");
        const possibleDuplicate = duplicateMarker.exists
            ? typeof markerOwnerId === "string" && markerOwnerId !== key
            : Boolean(legacyDuplicate);
        const effectiveReasons = possibleDuplicate
            ? Array.from(new Set([...reasons, "possible_duplicate"]))
            : reasons;
        const effectivePublicData = possibleDuplicate ? null : publicData;
        const releaseUnusedIncomingImages = () => {
            obsoleteImagePaths = getUnreferencedTelegramImagePaths(
                { imagePaths: images.paths },
                [current?.candidate, current?.pendingRevision],
            );
        };
        const stageDedupMarker = () => {
            if (!duplicateMarker.exists) {
                transaction.create(duplicateMarkerRef, {
                    state: "dedup_marker",
                    duplicateFingerprint,
                    recordId: legacyDuplicate?.id ?? key,
                    createdAt: now,
                });
            }
        };
        if (current?.state === "rejected" || current?.state === "deactivated") {
            releaseUnusedIncomingImages();
            return "sticky_terminal";
        }
        if (Array.isArray(current?.rejectedRevisionParsedHashes) && current.rejectedRevisionParsedHashes.includes(parsed.contentHash)) {
            releaseUnusedIncomingImages();
            return "duplicate";
        }
        if (current?.contentHash === contentHash && !isEdited) {
            releaseUnusedIncomingImages();
            return "duplicate";
        }
        if (!isEdited && getStoredTransportFingerprint(current ?? {}, current?.candidate) === transportIndependentFingerprint) {
            releaseUnusedIncomingImages();
            return "duplicate";
        }

        if (current?.state === "published") {
            if (!isEdited && current.contentHash === contentHash) return "duplicate";
            stageDedupMarker();
            obsoleteImagePaths = getUnreferencedTelegramImagePaths(
                current.pendingRevision,
                [current.candidate, candidate],
            );
            transaction.update(recordRef, {
                pendingRevision: candidate,
                pendingRevisionContentHash: contentHash,
                pendingRevisionParsedContentHash: parsed.contentHash,
                pendingRevisionDuplicateFingerprint: duplicateFingerprint,
                pendingRevisionTransportIndependentFingerprint: transportIndependentFingerprint,
                pendingRevisionReasons: Array.from(new Set([...reasons, "edited_after_publish"])),
                pendingRevisionReceivedAt: now,
                rightsFields: parsed.permittedFields,
                sourceUpdatedAt: now,
                updateCount: (typeof current?.updateCount === "number" ? current.updateCount : 0) + 1,
            });
            return "edited_needs_review";
        }

        if (current?.state === "pending_review") {
            stageDedupMarker();
            obsoleteImagePaths = getUnreferencedTelegramImagePaths(current.candidate, candidate);
            transaction.update(recordRef, {
                candidate,
                contentHash,
                parsedContentHash: parsed.contentHash,
                duplicateFingerprint,
                transportIndependentFingerprint,
                rightsFields: parsed.permittedFields,
                reviewReasons: effectiveReasons,
                sourceUrl: parsed.sourceUrl,
                sourcePublishedAt: parsed.publishedAt,
                sourceUpdatedAt: now,
                updatedAt: now,
                updateCount: (typeof current?.updateCount === "number" ? current.updateCount : 0) + 1,
            });
            return "updated_review";
        }

        if (adSnap.exists) throw new Error("telegram-ad-id-collision");
        const recordBase = {
            sourceId: parsed.sourceId,
            rightsFields: parsed.permittedFields,
            chatId: parsed.chatId,
            messageId: parsed.messageId,
            sourceUrl: parsed.sourceUrl,
            sourcePublishedAt: parsed.publishedAt,
            parsedContentHash: parsed.contentHash,
            duplicateFingerprint,
            transportIndependentFingerprint,
            sourceUpdatedAt: now,
            contentHash,
            candidate,
            receivedAt: now,
            updatedAt: now,
            updateCount: 1,
        };
        const day = new Date(now).toISOString().slice(0, 10);
        const quotaRef = db.collection(DAILY_LIMITS).doc(`telegram_${day}`);
        const quotaSnap = await transaction.get(quotaRef);
        const storedDay = quotaSnap.get("day");
        const storedCount = storedDay === day ? quotaSnap.get("count") : 0;
        if (!Number.isSafeInteger(storedCount) || (storedCount as number) < 0 || (storedCount as number) >= DAILY_LIMIT) {
            return "daily_limit";
        }

        stageDedupMarker();
        const nextCount = (storedCount as number) + 1;
        const nextMonth = new Date(`${day}T00:00:00.000Z`);
        nextMonth.setUTCDate(nextMonth.getUTCDate() + 35);
        transaction.set(quotaRef, {
            day,
            count: nextCount,
            updatedAt: now,
            expireAt: nextMonth,
        }, { merge: true });

        if (!effectivePublicData) {
            transaction.create(recordRef, {
                ...recordBase,
                state: "pending_review",
                reviewReasons: effectiveReasons.length ? effectiveReasons : ["manual_review_required"],
            });
            return "review";
        }
        transaction.create(adRef, { ...effectivePublicData, id: adRef.id });
        transaction.create(recordRef, { ...recordBase, state: "published", adId: adRef.id, reviewReasons: [], publishedAt: now });
        return "created";
    });
    if (result === "updated_review" || result === "edited_needs_review" || result === "duplicate" || result === "sticky_terminal") {
        await cleanupTelegramImages(obsoleteImagePaths, options.deletePhotos ?? deleteTelegramPhotos);
    }
    return result;
}

function safeCandidateForResponse(data: FirebaseFirestore.DocumentData): Record<string, unknown> {
    const source = data as Record<string, unknown>;
    return {
        title: source.title ?? "",
        description: source.description ?? "",
        category: source.category ?? "",
        catalogCategory: source.catalogCategory ?? "",
        catalogSubcategory: source.catalogSubcategory ?? "",
        priceType: source.priceType ?? "",
        price: source.price ?? "",
        exchangeDetails: source.exchangeDetails ?? "",
        city: source.city ?? "",
        voivodeship: source.voivodeship ?? "",
        sellerContact: source.sellerContact ?? "",
        images: Array.isArray(source.images) ? source.images.slice(0, MAX_IMAGES) : [],
    };
}

export async function listTelegramModerationItems(db: Firestore, auth: { token: Record<string, unknown> } | undefined) {
    const { requireTelegramAdmin } = await import("./telegramWebhookAdmin.js");
    requireTelegramAdmin(auth);
    const snapshot = await db.collection(IMPORT_RECORDS).where("state", "in", ["pending_review", "published"]).limit(300).get();
    return snapshot.docs.flatMap((document) => {
        const data = document.data();
        const hasPendingRevision = data.pendingRevision && typeof data.pendingRevision === "object";
        if (data.state !== "pending_review" && !hasPendingRevision) return [];
        const candidate = hasPendingRevision ? data.pendingRevision as FirebaseFirestore.DocumentData : data.candidate as FirebaseFirestore.DocumentData;
        return [{
            id: document.id,
            expectedContentHash: typeof (hasPendingRevision ? data.pendingRevisionContentHash : data.contentHash) === "string"
                ? (hasPendingRevision ? data.pendingRevisionContentHash : data.contentHash)
                : "",
            state: data.state,
            sourceUrl: typeof data.sourceUrl === "string" ? data.sourceUrl : "",
            receivedAt: typeof data.receivedAt === "number" ? data.receivedAt : 0,
            reviewReasons: Array.isArray(hasPendingRevision ? data.pendingRevisionReasons : data.reviewReasons)
                ? (hasPendingRevision ? data.pendingRevisionReasons : data.reviewReasons).filter((reason: unknown) => typeof reason === "string").slice(0, 20)
                : [],
            candidate: safeCandidateForResponse(candidate ?? {}),
            isPublishedEdit: Boolean(hasPendingRevision),
        }];
    }).sort((left, right) => right.receivedAt - left.receivedAt).slice(0, 100);
}

function validateModerationPayload(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpsError("invalid-argument", "Invalid ad data.");
    const data = value as Record<string, unknown>;
    const allowed = ["title", "description", "category", "catalogCategory", "catalogSubcategory", "city", "voivodeship", "priceType", "price", "exchangeDetails", "sellerContact"];
    if (Object.keys(data).some((key) => !allowed.includes(key))) throw new HttpsError("invalid-argument", "Invalid ad data.");
    return data;
}

export async function moderateTelegramImport(
    db: Firestore,
    auth: { token: Record<string, unknown> } | undefined,
    request: unknown,
    options: { deletePhotos?: (paths: string[]) => Promise<void> } = {},
): Promise<{ approved: true; adId: string } | { rejected: true } | { rejectedEdit: true }> {
    const { requireTelegramAdmin } = await import("./telegramWebhookAdmin.js");
    requireTelegramAdmin(auth);
    if (!request || typeof request !== "object" || Array.isArray(request)) throw new HttpsError("invalid-argument", "Invalid moderation request.");
    const data = request as Record<string, unknown>;
    if (typeof data.id !== "string" || !/^[a-f0-9]{64}$/.test(data.id) || !["approve", "reject"].includes(String(data.action))) {
        throw new HttpsError("invalid-argument", "Invalid moderation request.");
    }
    if (typeof data.expectedContentHash !== "string" || !/^[a-f0-9]{64}$/.test(data.expectedContentHash)) {
        throw new HttpsError("invalid-argument", "Refresh the moderation item before applying a decision.");
    }
    const recordRef = db.collection(IMPORT_RECORDS).doc(data.id);
    const recordSnap = await recordRef.get();
    if (!recordSnap.exists) throw new HttpsError("not-found", "Telegram import was not found.");
    const record = recordSnap.data() ?? {};
    if (record.state === "rejected" || record.state === "deactivated") throw new HttpsError("failed-precondition", "This Telegram import is closed.");
    const pendingRevision = record.pendingRevision && typeof record.pendingRevision === "object";
    const currentCandidate = (pendingRevision ? record.pendingRevision : record.candidate) as FirebaseFirestore.DocumentData | undefined;
    if (!currentCandidate) throw new HttpsError("failed-precondition", "The Telegram import has no candidate data.");
    const actor = typeof auth?.token.email === "string" ? auth.token.email.trim().toLowerCase() : "admin";
    const now = Date.now();

    if (data.action === "reject") {
        const result = await db.runTransaction(async (transaction) => {
            const currentSnap = await transaction.get(recordRef);
            if (!currentSnap.exists) throw new HttpsError("not-found", "Telegram import was not found.");
            const current = currentSnap.data() ?? {};
            const isEdit = Boolean(current.pendingRevision);
            if (current.state === "rejected" || current.state === "deactivated") throw new HttpsError("failed-precondition", "This Telegram import is closed.");
            const currentHash = isEdit ? current.pendingRevisionContentHash : current.contentHash;
            if (currentHash !== data.expectedContentHash) throw new HttpsError("aborted", "This import changed. Refresh the moderation queue.");
            const rejectedRevisionHashes = Array.isArray(current.rejectedRevisionParsedHashes)
                ? current.rejectedRevisionParsedHashes.filter((hash: unknown): hash is string => typeof hash === "string")
                : [];
            if (typeof current.pendingRevisionParsedContentHash === "string") {
                rejectedRevisionHashes.push(current.pendingRevisionParsedContentHash);
            }
            transaction.update(recordRef, isEdit ? {
                pendingRevision: null,
                pendingRevisionContentHash: null,
                pendingRevisionParsedContentHash: null,
                pendingRevisionDuplicateFingerprint: null,
                pendingRevisionTransportIndependentFingerprint: null,
                pendingRevisionReasons: null,
                rejectedEditAt: now,
                rejectedEditBy: actor,
                rejectedRevisionParsedHashes: Array.from(new Set(rejectedRevisionHashes)).slice(-20),
                rejectReason: typeof data.reason === "string" ? data.reason.slice(0, 240) : "",
                updatedAt: now,
            } : {
                state: "rejected",
                rejectedAt: now,
                rejectedBy: actor,
                rejectReason: typeof data.reason === "string" ? data.reason.slice(0, 240) : "",
                updatedAt: now,
            });
            return isEdit;
        });
        const obsoleteImagePaths = getUnreferencedTelegramImagePaths(
            currentCandidate,
            result ? record.candidate : undefined,
        );
        await cleanupTelegramImages(obsoleteImagePaths, options.deletePhotos ?? deleteTelegramPhotos);
        return result ? { rejectedEdit: true } : { rejected: true };
    }

    const payload = validateModerationPayload(data.ad);
    const images = Array.isArray(currentCandidate.images) ? currentCandidate.images.slice(0, MAX_IMAGES) : [];
    const paths = getSafeTelegramImagePaths(currentCandidate.imagePaths);
    const permittedFields = new Set<string>(Array.isArray(record.rightsFields)
        ? record.rightsFields.filter((field: unknown): field is string => typeof field === "string")
        : []);
    for (const requiredField of ["title", "originalUrl", "description", "category", "price", "location"]) {
        if (!permittedFields.has(requiredField)) {
            throw new HttpsError("failed-precondition", "The source permission does not cover all required ad fields.");
        }
    }
    if (typeof payload.sellerContact === "string" && payload.sellerContact.trim() && !permittedFields.has("contact")) {
        throw new HttpsError("failed-precondition", "The source permission does not cover contact details.");
    }
    if (images.length && !permittedFields.has("images")) {
        throw new HttpsError("failed-precondition", "The source permission does not cover images.");
    }
    let publicData: Record<string, unknown>;
    try {
        publicData = buildTrustedTelegramAdData({
            ...payload,
            images,
        }, now) as Record<string, unknown>;
    } catch {
        throw new HttpsError("invalid-argument", "Complete all required fields with valid values before approval.");
    }
    if (typeof record.sourceUrl !== "string" || !/^https:\/\/t\.me\/[A-Za-z0-9_]+\//.test(record.sourceUrl)) {
        throw new HttpsError("failed-precondition", "The original Telegram link is invalid.");
    }
    const adId = `telegram_${data.id}`;
    const adRef = db.collection("ads").doc(adId);
    await db.runTransaction(async (transaction) => {
        const currentSnap = await transaction.get(recordRef);
        const adSnap = await transaction.get(adRef);
        if (!currentSnap.exists) throw new HttpsError("not-found", "Telegram import was not found.");
        const current = currentSnap.data() ?? {};
        const isEdit = Boolean(current.pendingRevision);
        if (current.state === "rejected" || current.state === "deactivated" || (!isEdit && current.state === "published")) {
            throw new HttpsError("failed-precondition", "This Telegram import is closed.");
        }
        const currentHash = isEdit ? current.pendingRevisionContentHash : current.contentHash;
        if (currentHash !== data.expectedContentHash) throw new HttpsError("aborted", "This import changed. Refresh the moderation queue.");
        const original = current.sourceUrl;
        const adData = {
            ...publicData,
            ...(adSnap.exists ? { createdAt: adSnap.get("createdAt") } : {}),
            id: adId,
            sourceType: "telegram",
            sourceName: "Telegram",
            sourceUrl: original,
            sourcePublishedAt: current.sourcePublishedAt,
            importedAt: adSnap.exists ? adSnap.get("importedAt") : now,
            sourceUpdatedAt: now,
        };
        if (adSnap.exists) transaction.update(adRef, adData);
        else transaction.create(adRef, adData);
        transaction.update(recordRef, {
            state: "published",
            candidate: { ...currentCandidate, ...payload, images, imagePaths: paths },
            ...(typeof current.pendingRevisionDuplicateFingerprint === "string"
                ? { duplicateFingerprint: current.pendingRevisionDuplicateFingerprint }
                : typeof current.duplicateFingerprint === "string"
                    ? { duplicateFingerprint: current.duplicateFingerprint }
                    : {}),
            ...(typeof current.pendingRevisionTransportIndependentFingerprint === "string"
                ? { transportIndependentFingerprint: current.pendingRevisionTransportIndependentFingerprint }
                : typeof current.transportIndependentFingerprint === "string"
                    ? { transportIndependentFingerprint: current.transportIndependentFingerprint }
                    : {}),
            reviewReasons: [],
            adId,
            publishedAt: adSnap.exists ? current.publishedAt : now,
            approvedAt: now,
            approvedBy: actor,
            updatedAt: now,
        });

        if (isEdit) {
            transaction.update(recordRef, {
                pendingRevision: null,
                pendingRevisionContentHash: null,
                pendingRevisionParsedContentHash: null,
                pendingRevisionDuplicateFingerprint: null,
                pendingRevisionTransportIndependentFingerprint: null,
                pendingRevisionReasons: null,
            });
        }
    });
    const obsoleteImagePaths = getUnreferencedTelegramImagePaths(
        record.candidate,
        { imagePaths: paths },
    );
    await cleanupTelegramImages(obsoleteImagePaths, options.deletePhotos ?? deleteTelegramPhotos);
    return { approved: true, adId };
}

export async function deactivateTelegramImportRecord(db: Firestore, recordId: string, reason: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(recordId)) throw new HttpsError("invalid-argument", "Invalid Telegram import id.");
    const ref = db.collection(IMPORT_RECORDS).doc(recordId);
    await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Telegram import was not found.");
        const data = snap.data() ?? {};
        const adId = data.adId;
        if (typeof adId === "string" && data.state === "published") {
            const adRef = db.collection("ads").doc(adId);
            const adSnap = await transaction.get(adRef);
            if (adSnap.exists && adSnap.get("sourceType") === "telegram") {
                transaction.update(adRef, { status: "hidden", telegramDeactivatedAt: Date.now() });
            }
        }
        transaction.update(ref, {
            state: "deactivated",
            deactivatedAt: Date.now(),
            deactivationReason: reason.slice(0, 240),
            pendingRevision: admin.firestore.FieldValue.delete(),
            updatedAt: Date.now(),
        });
    });
}
