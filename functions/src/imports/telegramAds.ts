import { createHash, randomUUID } from "node:crypto";
import * as admin from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { buildTrustedTelegramAdData } from "../listings/createAd";
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

export function createTelegramImportKey(sourceId: string, chatId: string, messageId: number): string {
    return createHash("sha256").update(`${sourceId}\0${chatId}\0${messageId}`).digest("hex");
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
): Promise<TelegramIngestResult> {
    const key = createTelegramImportKey(parsed.sourceId, parsed.chatId, parsed.messageId);
    const recordRef = db.collection(IMPORT_RECORDS).doc(key);
    const adRef = db.collection("ads").doc(`telegram_${key}`);
    const candidate = toSafeCandidate(parsed, images);
    const reasons = [...parsed.reviewReasons];
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

    return db.runTransaction(async (transaction) => {
        const recordSnap = await transaction.get(recordRef);
        const current = recordSnap.exists ? recordSnap.data() : undefined;
        const adSnap = await transaction.get(adRef);
        if (current?.state === "rejected" || current?.state === "deactivated") return "sticky_terminal";
        if (Array.isArray(current?.rejectedRevisionParsedHashes) && current.rejectedRevisionParsedHashes.includes(parsed.contentHash)) return "duplicate";
        if (current?.contentHash === contentHash && !isEdited) return "duplicate";

        if (current?.state === "published") {
            if (!isEdited && current.contentHash === contentHash) return "duplicate";
            transaction.update(recordRef, {
                pendingRevision: candidate,
                pendingRevisionContentHash: contentHash,
                pendingRevisionParsedContentHash: parsed.contentHash,
                pendingRevisionReasons: Array.from(new Set([...reasons, "edited_after_publish"])),
                pendingRevisionReceivedAt: now,
                sourceUpdatedAt: now,
                updateCount: (typeof current?.updateCount === "number" ? current.updateCount : 0) + 1,
            });
            return "edited_needs_review";
        }

        if (current?.state === "pending_review") {
            transaction.update(recordRef, {
                candidate,
                contentHash,
                parsedContentHash: parsed.contentHash,
                reviewReasons: Array.from(new Set(reasons)),
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
            chatId: parsed.chatId,
            messageId: parsed.messageId,
            sourceUrl: parsed.sourceUrl,
            sourcePublishedAt: parsed.publishedAt,
            parsedContentHash: parsed.contentHash,
            sourceUpdatedAt: now,
            contentHash,
            candidate,
            receivedAt: now,
            updatedAt: now,
            updateCount: 1,
        };
        if (!publicData) {
            transaction.create(recordRef, {
                ...recordBase,
                state: "pending_review",
                reviewReasons: Array.from(new Set(reasons.length ? reasons : ["manual_review_required"])),
            });
            return "review";
        }

        const day = new Date(now).toISOString().slice(0, 10);
        const quotaRef = db.collection(DAILY_LIMITS).doc(`telegram_${day}`);
        const quotaSnap = await transaction.get(quotaRef);
        const storedDay = quotaSnap.get("day");
        const storedCount = storedDay === day ? quotaSnap.get("count") : 0;
        if (!Number.isSafeInteger(storedCount) || (storedCount as number) < 0 || (storedCount as number) >= DAILY_LIMIT) {
            transaction.create(recordRef, {
                ...recordBase,
                state: "pending_review",
                reviewReasons: [...new Set([...reasons, "daily_import_limit_reached"])],
            });
            return "daily_limit";
        }
        transaction.create(adRef, { ...publicData, id: adRef.id });
        transaction.create(recordRef, { ...recordBase, state: "published", adId: adRef.id, reviewReasons: [], publishedAt: now });
        const nextMonth = new Date(`${day}T00:00:00.000Z`);
        nextMonth.setUTCDate(nextMonth.getUTCDate() + 35);
        transaction.set(quotaRef, {
            day,
            count: (storedCount as number) + 1,
            updatedAt: now,
            expireAt: nextMonth,
        }, { merge: true });
        return "created";
    });
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
                pendingRevision: admin.firestore.FieldValue.delete(),
                pendingRevisionContentHash: admin.firestore.FieldValue.delete(),
                pendingRevisionParsedContentHash: admin.firestore.FieldValue.delete(),
                pendingRevisionReasons: admin.firestore.FieldValue.delete(),
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
        const obsoleteImagePaths = Array.isArray(currentCandidate.imagePaths) ? currentCandidate.imagePaths.filter((path) => typeof path === "string") as string[] : [];
        if (!result && obsoleteImagePaths.length) await defaultTelegramPhotoStorage().delete(obsoleteImagePaths);
        return result ? { rejectedEdit: true } : { rejected: true };
    }

    const payload = validateModerationPayload(data.ad);
    const images = Array.isArray(currentCandidate.images) ? currentCandidate.images.slice(0, MAX_IMAGES) : [];
    const paths = Array.isArray(currentCandidate.imagePaths) ? currentCandidate.imagePaths : [];
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
    const day = new Date(now).toISOString().slice(0, 10);
    const quotaRef = db.collection(DAILY_LIMITS).doc(`telegram_${day}`);
    await db.runTransaction(async (transaction) => {
        const currentSnap = await transaction.get(recordRef);
        const adSnap = await transaction.get(adRef);
        const quotaSnap = await transaction.get(quotaRef);
        if (!currentSnap.exists) throw new HttpsError("not-found", "Telegram import was not found.");
        const current = currentSnap.data() ?? {};
        const isEdit = Boolean(current.pendingRevision);
        if (current.state === "rejected" || current.state === "deactivated" || (!isEdit && current.state === "published")) {
            throw new HttpsError("failed-precondition", "This Telegram import is closed.");
        }
        const currentHash = isEdit ? current.pendingRevisionContentHash : current.contentHash;
        if (currentHash !== data.expectedContentHash) throw new HttpsError("aborted", "This import changed. Refresh the moderation queue.");
        const storedDay = quotaSnap.get("day");
        const count = storedDay === day ? quotaSnap.get("count") : 0;
        if (!isEdit && (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) >= DAILY_LIMIT)) {
            throw new HttpsError("resource-exhausted", "Telegram daily import limit reached.");
        }
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
                pendingRevisionReasons: null,
            });
        }
        if (!isEdit) {
            const nextMonth = new Date(`${day}T00:00:00.000Z`);
            nextMonth.setUTCDate(nextMonth.getUTCDate() + 35);
            transaction.set(quotaRef, {
                day,
                count: (count as number) + 1,
                updatedAt: now,
                expireAt: nextMonth,
            }, { merge: true });
        }
    });
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
