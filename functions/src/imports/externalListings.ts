import { createHash } from "node:crypto";
import { isIP } from "node:net";

export type ExternalListingCategory = "work" | "sell" | "buy" | "service" | "rent";
export type ExternalOfferType = "paid" | "free" | "exchange" | "unknown";
export type ExternalListingStatus = "active" | "stale" | "hidden" | "review";
export type ExternalListingField = "title" | "originalUrl" | "description" | "price" | "category" | "location" | "images" | "publishedAt" | "status" | "contact";

export type ExternalListingCandidate = {
    sourceListingId: unknown;
    originalUrl: unknown;
    title: unknown;
    description?: unknown;
    sourceCategory?: unknown;
    offerType?: unknown;
    priceAmount?: unknown;
    currency?: unknown;
    city?: unknown;
    voivodeship?: unknown;
    location?: { lat?: unknown; lng?: unknown } | null;
    images?: unknown;
    sourcePublishedAt?: unknown;
    sourceStatus?: unknown;
    /** Keep a qualified record hidden for human review even when its category is mapped. */
    requiresReview?: unknown;
};

export type ExternalListing = {
    id: string;
    isExternal: true;
    sourceId: string;
    sourceName?: string;
    sourceListingId: string;
    originalUrl: string;
    normalizedUrlHash: string;
    title: string;
    description?: string;
    category?: ExternalListingCategory;
    catalogCategory?: string;
    catalogSubcategory?: string;
    sourceCategory?: string;
    offerType: ExternalOfferType;
    priceAmount?: number;
    currency?: string;
    priceSortGroup: 0 | 1;
    priceSortAmount: number;
    city?: string;
    voivodeship?: string;
    location?: { lat: number; lng: number };
    images?: string[];
    sourcePublishedAt?: number;
    createdAt: number;
    importedAt: number;
    lastSuccessfulSyncAt: number;
    lastSeenAt: number;
    status: ExternalListingStatus;
    importStatus: "ready" | "needs_review";
    rightsReference: string;
    rightsReviewedAt: number;
};

export type ExternalListingSource = {
    id: string;
    displayName?: string;
    allowedListingHosts: readonly string[];
    allowedImageHosts: readonly string[];
    rights: {
        reference: string;
        reviewedAt: number;
        permissionConfirmed: boolean;
        fields: readonly ExternalListingField[];
    };
    categoryMappings: Readonly<Record<string, {
        category?: ExternalListingCategory;
        catalogCategory?: string;
        catalogSubcategory?: string;
    }>>;
};

export class ExternalListingValidationError extends Error {
    constructor(readonly code: string) {
        super(code);
        this.name = "ExternalListingValidationError";
    }
}

const CATEGORY_IDS = new Set<ExternalListingCategory>(["work", "sell", "buy", "service", "rent"]);
const OFFER_TYPES = new Set<ExternalOfferType>(["paid", "free", "exchange", "unknown"]);
const SOURCE_FIELDS = new Set<ExternalListingField>(["title", "originalUrl", "description", "price", "category", "location", "images", "publishedAt", "status", "contact"]);
const CATALOG_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
    animals: ["dogsCats", "birds", "farmAnimals", "other"],
    electronics: ["phonesComputers", "homeAppliances", "tvAudio", "other"],
    furniture: ["furniture", "interiorDecor", "lighting", "other"],
    clothing: ["womenClothing", "menClothing", "shoes", "accessories", "other"],
    construction: ["bricksTools", "buildingMaterials", "renovation", "other"],
    transport: ["cars", "motorcycles", "vehicleParts", "other"],
    garden: ["plants", "gardenFurniture", "gardenTools", "other"],
    children: ["toys", "childrenClothing", "strollers", "other"],
    other: ["miscellaneous"],
};

function normalizeText(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.replace(/\uFEFF/g, "").replace(/[\t \u00A0]+/g, " ").replace(/ *\n */g, "\n").trim();
    return normalized ? normalized.slice(0, maxLength) : undefined;
}

function isAllowedHttpsUrl(value: unknown, hosts: readonly string[]): value is string {
    if (typeof value !== "string" || value.length > 2048) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" &&
            !url.username && !url.password &&
            (!url.port || url.port === "443") &&
            !url.hostname.endsWith(".") &&
            hosts.some((host) => url.hostname.toLowerCase() === host.toLowerCase());
    } catch {
        return false;
    }
}

function normalizeSourceId(value: string): string {
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(value)) {
        throw new ExternalListingValidationError("invalid-source-id");
    }
    return value.toLowerCase();
}

export function validateExternalListingSource(source: ExternalListingSource): void {
    const normalizedId = normalizeSourceId(source.id);
    if (source.id !== normalizedId) throw new ExternalListingValidationError("source-id-must-be-lowercase");
    let rightsUrl: URL | undefined;
    try {
        rightsUrl = new URL(source.rights?.reference ?? "");
    } catch {
        throw new ExternalListingValidationError("source-rights-not-reviewed");
    }
    if (!rightsUrl || rightsUrl.protocol !== "https:" || rightsUrl.username || rightsUrl.password ||
        !Number.isFinite(source.rights.reviewedAt) || source.rights.reviewedAt <= 0 ||
        source.rights.permissionConfirmed !== true ||
        !Array.isArray(source.rights.fields) ||
        !source.rights.fields.every((field) => SOURCE_FIELDS.has(field)) ||
        !source.rights.fields.includes("title") || !source.rights.fields.includes("originalUrl")) {
        throw new ExternalListingValidationError("source-rights-not-reviewed");
    }
    const isSafeHost = (host: string) => {
        if (typeof host !== "string") return false;
        const normalized = host.toLowerCase();
        return normalized === host && normalized.includes(".") && !isIP(normalized) &&
            !normalized.endsWith(".") && !normalized.endsWith(".localhost") &&
            !normalized.endsWith(".local") && !normalized.endsWith(".internal");
    };
    if (!source.allowedListingHosts.length || !source.allowedListingHosts.every(isSafeHost) ||
        !source.allowedImageHosts.every(isSafeHost)) {
        throw new ExternalListingValidationError("source-host-not-configured");
    }
}

function normalizeLocation(value: ExternalListingCandidate["location"]): { lat: number; lng: number } | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { lat, lng } = value;
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
    return { lat, lng };
}

function normalizePrice(candidate: ExternalListingCandidate): Pick<ExternalListing, "offerType" | "priceAmount" | "currency"> {
    let offerType: ExternalOfferType;
    if (candidate.offerType === undefined || candidate.offerType === null || candidate.offerType === "") {
        const hasPriceData = candidate.priceAmount !== undefined && candidate.priceAmount !== null ||
            candidate.currency !== undefined && candidate.currency !== null;
        if (!hasPriceData) return { offerType: "unknown" };
        if (typeof candidate.priceAmount !== "number" || !Number.isFinite(candidate.priceAmount) || candidate.priceAmount < 0 ||
            typeof candidate.currency !== "string" || !/^[A-Za-z]{3}$/.test(candidate.currency)) {
            throw new ExternalListingValidationError("invalid-price");
        }
        offerType = "paid";
    } else if (typeof candidate.offerType === "string" && OFFER_TYPES.has(candidate.offerType as ExternalOfferType)) {
        offerType = candidate.offerType as ExternalOfferType;
    } else {
        throw new ExternalListingValidationError("invalid-offer-type");
    }

    if (offerType !== "paid") return { offerType };
    if (typeof candidate.priceAmount !== "number" || !Number.isFinite(candidate.priceAmount) || candidate.priceAmount < 0 ||
        typeof candidate.currency !== "string" || !/^[A-Za-z]{3}$/.test(candidate.currency)) {
        throw new ExternalListingValidationError("invalid-price");
    }

    return {
        offerType,
        priceAmount: candidate.priceAmount,
        currency: candidate.currency.toUpperCase(),
    };
}

export function createExternalListingDocumentId(sourceId: string, sourceListingId: string): string {
    const normalizedSourceId = normalizeSourceId(sourceId);
    return `${normalizedSourceId}_${createHash("sha256").update(sourceListingId).digest("hex")}`;
}

export function createExternalListingUrlHash(sourceId: string, originalUrl: string): string {
    const normalizedSourceId = normalizeSourceId(sourceId);
    return createHash("sha256").update(`${normalizedSourceId}\0${originalUrl}`).digest("hex");
}

function normalizeOriginalUrl(value: string): string {
    const url = new URL(value);
    // Fragments are client-only and do not identify a different source listing.
    url.hash = "";
    return url.href;
}

export function normalizeExternalListing(
    candidate: ExternalListingCandidate,
    source: ExternalListingSource,
    now: number,
): ExternalListing {
    validateExternalListingSource(source);
    if (!Number.isFinite(now) || now <= 0) throw new ExternalListingValidationError("invalid-import-time");
    if (typeof candidate.sourceListingId !== "string" || !candidate.sourceListingId.trim() || candidate.sourceListingId.length > 240) {
        throw new ExternalListingValidationError("invalid-source-listing-id");
    }
    if (!isAllowedHttpsUrl(candidate.originalUrl, source.allowedListingHosts)) {
        throw new ExternalListingValidationError("unsafe-original-url");
    }
    const originalUrl = normalizeOriginalUrl(candidate.originalUrl);

    const title = normalizeText(candidate.title, 300);
    if (!title) throw new ExternalListingValidationError("missing-title");

    const sourceCategory = source.rights.fields.includes("category")
        ? normalizeText(candidate.sourceCategory, 200)
        : undefined;
    const categoryMapping = sourceCategory ? source.categoryMappings[sourceCategory] : undefined;
    const category = categoryMapping?.category && CATEGORY_IDS.has(categoryMapping.category)
        ? categoryMapping.category
        : undefined;
    const validCatalogCategory = categoryMapping?.catalogCategory &&
        Object.prototype.hasOwnProperty.call(CATALOG_CATEGORIES, categoryMapping.catalogCategory)
        ? categoryMapping.catalogCategory
        : undefined;
    const validCatalogSubcategory = validCatalogCategory && categoryMapping?.catalogSubcategory &&
        CATALOG_CATEGORIES[validCatalogCategory].includes(categoryMapping.catalogSubcategory)
        ? categoryMapping.catalogSubcategory
        : undefined;
    if (source.rights.fields.includes("status") && candidate.sourceStatus !== undefined &&
        candidate.sourceStatus !== "active" && candidate.sourceStatus !== "stale") {
        throw new ExternalListingValidationError("invalid-source-status");
    }
    const sourceStatus = source.rights.fields.includes("status") ? candidate.sourceStatus : undefined;
    const canPublish = category && candidate.requiresReview !== true;
    const listingStatus: ExternalListingStatus = sourceStatus === "stale" ? "stale" : canPublish ? "active" : "review";
    const price = source.rights.fields.includes("price")
        ? normalizePrice(candidate)
        : { offerType: "unknown" as const };
    const priceSortGroup: 0 | 1 = price.offerType === "paid" && price.currency === "PLN" ? 0 : 1;

    const listing: ExternalListing = {
        id: createExternalListingDocumentId(source.id, candidate.sourceListingId.trim()),
        isExternal: true,
        sourceId: normalizeSourceId(source.id),
        ...(normalizeText(source.displayName, 120) ? { sourceName: normalizeText(source.displayName, 120) } : {}),
        sourceListingId: candidate.sourceListingId.trim(),
        originalUrl,
        normalizedUrlHash: createExternalListingUrlHash(source.id, originalUrl),
        title,
        ...price,
        priceSortGroup,
        priceSortAmount: priceSortGroup === 0 ? price.priceAmount ?? 0 : 0,
        importedAt: now,
        createdAt: source.rights.fields.includes("publishedAt") &&
            typeof candidate.sourcePublishedAt === "number" && Number.isFinite(candidate.sourcePublishedAt) && candidate.sourcePublishedAt > 0
            ? candidate.sourcePublishedAt
            : now,
        lastSuccessfulSyncAt: now,
        lastSeenAt: now,
        status: listingStatus,
        importStatus: canPublish ? "ready" : "needs_review",
        rightsReference: source.rights.reference,
        rightsReviewedAt: source.rights.reviewedAt,
    };

    if (sourceCategory) listing.sourceCategory = sourceCategory;
    if (category) listing.category = category;
    if (validCatalogCategory) listing.catalogCategory = validCatalogCategory;
    if (validCatalogSubcategory) listing.catalogSubcategory = validCatalogSubcategory;

    if (source.rights.fields.includes("description")) {
        const description = normalizeText(candidate.description, 15_000);
        if (description) listing.description = description;
    }
    if (source.rights.fields.includes("location")) {
        const city = normalizeText(candidate.city, 160);
        const voivodeship = normalizeText(candidate.voivodeship, 120);
        const location = normalizeLocation(candidate.location);
        if (city) listing.city = city;
        if (voivodeship) listing.voivodeship = voivodeship;
        if (location) listing.location = location;
    }
    if (source.rights.fields.includes("images") && Array.isArray(candidate.images)) {
        const images = candidate.images.filter((url): url is string => isAllowedHttpsUrl(url, source.allowedImageHosts)).slice(0, 8);
        if (images.length) listing.images = images;
    }
    if (source.rights.fields.includes("publishedAt") && typeof candidate.sourcePublishedAt === "number" &&
        Number.isFinite(candidate.sourcePublishedAt) && candidate.sourcePublishedAt > 0) {
        listing.sourcePublishedAt = candidate.sourcePublishedAt;
    }

    return listing;
}
