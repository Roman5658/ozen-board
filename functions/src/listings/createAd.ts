import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ADS_PER_24_HOURS = 10;
const MAX_AD_IMAGES = 10;
const AD_CREATE_LIMITS_COLLECTION = "adCreateLimits";

type AdCategory = "work" | "sell" | "buy" | "service" | "rent";

type CreateAdInput = {
    title?: unknown;
    description?: unknown;
    category?: unknown;
    voivodeship?: unknown;
    city?: unknown;
    price?: unknown;
    images?: unknown;
    sellerContact?: unknown;
    userName?: unknown;
    userNickname?: unknown;
    location?: unknown;
};

type UserIdentity = {
    uid: string;
    email: string | null;
    userId: string;
    allIds: string[];
};

type UserAccountInfo = {
    nickname: string | null;
};

export const createAd = onCall(
    {
        timeoutSeconds: 20,
        maxInstances: 10,
    },
    async (request) => {
        const identity = requireUserIdentity(request.auth);
        const accountInfo = await getUserAccountInfo(identity);

        const now = Date.now();
        const since = now - DAY_MS;
        const input = (request.data ?? {}) as CreateAdInput;
        const adData = buildAdData(input, identity, accountInfo.nickname, now);
        const quotaRef = db.collection(AD_CREATE_LIMITS_COLLECTION).doc(getUserKey(identity.uid));
        const adRef = db.collection("ads").doc();

        await db.runTransaction(async (transaction) => {
            const quotaSnap = await transaction.get(quotaRef);
            const previousTimes = quotaSnap.exists
                ? readQuotaTimes(quotaSnap.data(), since)
                : await loadRecentAdCreatedAt(transaction, identity.allIds, since);

            const recentTimes = Array.from(new Set(previousTimes))
                .filter((time) => time >= since && time <= now)
                .sort((a, b) => a - b);

            if (recentTimes.length >= MAX_ADS_PER_24_HOURS) {
                throw new HttpsError(
                    "resource-exhausted",
                    "AD_DAILY_LIMIT_REACHED"
                );
            }

            transaction.create(adRef, adData);
            transaction.set(quotaRef, {
                userId: identity.userId,
                uid: identity.uid,
                email: identity.email,
                createdAtHistory: [...recentTimes, now],
                updatedAt: now,
            }, { merge: true });
        });

        return { id: adRef.id };
    }
);

function requireUserIdentity(auth: { uid?: string; token?: { email?: unknown } } | undefined): UserIdentity {
    const uid = typeof auth?.uid === "string" ? auth.uid.trim() : "";
    const email = typeof auth?.token?.email === "string"
        ? auth.token.email.trim().toLowerCase()
        : "";

    if (!uid) {
        throw new HttpsError("unauthenticated", "Sign in before creating an ad.");
    }

    const userId = email || uid;
    const allIds = Array.from(new Set([email, uid].filter(Boolean)));

    return {
        uid,
        email: email || null,
        userId,
        allIds,
    };
}

async function getUserAccountInfo(identity: UserIdentity): Promise<UserAccountInfo> {
    if (!identity.email) return { nickname: null };

    const userSnap = await db.collection("users").doc(identity.email).get();
    const userData = userSnap.exists ? userSnap.data() : null;
    const status = userData?.status;

    if (status === "blocked") {
        throw new HttpsError("permission-denied", "Account is restricted.");
    }

    const nickname = typeof userData?.nickname === "string"
        ? userData.nickname.trim()
        : "";

    return { nickname: nickname || null };
}

function buildAdData(
    input: CreateAdInput,
    identity: UserIdentity,
    trustedNickname: string | null,
    now: number
) {
    const title = requireText(input.title, "title", 200);
    const description = requireText(input.description, "description", 5000);
    const category = requireCategory(input.category);
    const voivodeship = requireText(input.voivodeship, "voivodeship", 120);
    const city = requireText(input.city, "city", 120);
    const price = requireText(input.price, "price", 80);
    const images = optionalStringArray(input.images, "images", MAX_AD_IMAGES, 2000);
    const sellerContact = optionalText(input.sellerContact, "sellerContact", 120);
    const displayName = trustedNickname ||
        optionalText(input.userNickname, "userNickname", 80) ||
        optionalText(input.userName, "userName", 80) ||
        "User";
    // Status is server-owned. Future paid creation logic should compute it here,
    // not accept it from the client payload.
    const status = "active";
    const location = optionalLocation(input.location);

    return {
        title,
        description,
        category,
        voivodeship,
        city,
        price,
        ...(images.length > 0 ? { images } : {}),
        ...(sellerContact ? { sellerContact } : {}),
        userId: identity.userId,
        userName: displayName,
        userNickname: displayName,
        createdAt: now,
        status,
        ...(location ? { location } : {}),
    };
}

async function loadRecentAdCreatedAt(
    transaction: FirebaseFirestore.Transaction,
    userIds: string[],
    since: number
): Promise<number[]> {
    const times = new Map<string, number>();

    for (const userId of userIds) {
        const snapshot = await transaction.get(
            db.collection("ads").where("userId", "==", userId)
        );

        snapshot.docs.forEach((doc) => {
            const createdAt = toMillis(doc.data().createdAt);
            if (createdAt !== null && createdAt >= since) {
                times.set(doc.id, createdAt);
            }
        });
    }

    return Array.from(times.values());
}

function readQuotaTimes(data: FirebaseFirestore.DocumentData | undefined, since: number): number[] {
    const raw = Array.isArray(data?.createdAtHistory) ? data?.createdAtHistory : [];

    return raw
        .map(toMillis)
        .filter((value): value is number => value !== null && value >= since);
}

function requireText(value: unknown, field: string, maxLength: number): string {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || text.length > maxLength) {
        throw new HttpsError("invalid-argument", `Invalid ${field}.`);
    }
    return text;
}

function optionalText(value: unknown, field: string, maxLength: number): string {
    if (value === undefined || value === null) return "";

    const text = typeof value === "string" ? value.trim() : "";
    if (text.length > maxLength) {
        throw new HttpsError("invalid-argument", `Invalid ${field}.`);
    }
    return text;
}

function requireCategory(value: unknown): AdCategory {
    if (
        value === "work" ||
        value === "sell" ||
        value === "buy" ||
        value === "service" ||
        value === "rent"
    ) {
        return value;
    }

    throw new HttpsError("invalid-argument", "Invalid category.");
}

function optionalStringArray(
    value: unknown,
    field: string,
    maxItems: number,
    maxItemLength: number
): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > maxItems) {
        throw new HttpsError("invalid-argument", `Invalid ${field}.`);
    }

    return value.map((item) => {
        if (typeof item !== "string") {
            throw new HttpsError("invalid-argument", `Invalid ${field}.`);
        }

        const text = item.trim();
        if (!text || text.length > maxItemLength) {
            throw new HttpsError("invalid-argument", `Invalid ${field}.`);
        }
        return text;
    });
}

function optionalLocation(value: unknown): { lat: number; lng: number } | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "object") {
        throw new HttpsError("invalid-argument", "Invalid location.");
    }

    const location = value as { lat?: unknown; lng?: unknown };
    if (
        typeof location.lat !== "number" ||
        typeof location.lng !== "number" ||
        !Number.isFinite(location.lat) ||
        !Number.isFinite(location.lng) ||
        location.lat < -90 ||
        location.lat > 90 ||
        location.lng < -180 ||
        location.lng > 180
    ) {
        throw new HttpsError("invalid-argument", "Invalid location.");
    }

    return {
        lat: location.lat,
        lng: location.lng,
    };
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

function getUserKey(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, (char) => `_${char.charCodeAt(0).toString(16)}_`);
}
