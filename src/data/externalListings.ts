import {
    collection,
    getDocs,
    limit,
    orderBy,
    query,
    startAfter,
    where,
    type Firestore,
    type QueryDocumentSnapshot,
    type QueryConstraint,
} from "firebase/firestore";
import { isCatalogCategoryId, isCatalogSubcategoryId } from "./catalogCategories";
import { shouldShowExternalSource } from "../utils/externalListingsVisibility";
import type { Ad } from "../types/ad";
import type { ExternalCatalogListing, ExternalOfferType } from "../types/externalListing";
import { filterAndSortAds, type CatalogFilterState } from "../utils/catalogFilters";

export const EXTERNAL_CATALOG_WINDOW_SIZE = 100;
export const EXTERNAL_CATALOG_PAGE_SIZE = 30;
export const EXTERNAL_CATALOG_MAX_SCAN = 500;

export type ExternalCatalogCursor = QueryDocumentSnapshot;

export type ExternalCatalogPage = {
    listings: ExternalCatalogListing[];
    cursor: ExternalCatalogCursor | null;
    hasMore: boolean;
    scanLimited: boolean;
};

function finitePositive(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function safeHttpsUrl(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 2048) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443");
    } catch {
        return false;
    }
}

function isAdCategory(value: unknown): value is Ad["category"] {
    return value === "work" || value === "sell" || value === "buy" || value === "service" || value === "rent";
}

function isExternalOfferType(value: unknown): value is ExternalOfferType {
    return value === "paid" || value === "free" || value === "exchange" || value === "unknown";
}

export function mapExternalCatalogListing(id: string, value: unknown): ExternalCatalogListing | null {
    if (!value || typeof value !== "object") return null;
    const data = value as Record<string, unknown>;
    if (data.status !== "active" || data.isExternal !== true || !safeHttpsUrl(data.originalUrl)) return null;
    if (typeof data.sourceId !== "string" || typeof data.sourceListingId !== "string" ||
        typeof data.title !== "string" || !data.title.trim() || !isExternalOfferType(data.offerType)) return null;

    const createdAt = finitePositive(data.sourcePublishedAt)
        ? data.sourcePublishedAt
        : finitePositive(data.createdAt)
            ? data.createdAt
            : finitePositive(data.importedAt)
                ? data.importedAt
                : finitePositive(data.lastSeenAt)
                    ? data.lastSeenAt
                    : 0;
    if (!createdAt) return null;

    const currency = typeof data.currency === "string" && /^[A-Z]{3}$/.test(data.currency)
        ? data.currency
        : undefined;
    const priceAmount = typeof data.priceAmount === "number" && Number.isFinite(data.priceAmount) && data.priceAmount >= 0
        ? data.priceAmount
        : undefined;
    const offerType = data.offerType;
    const normalizedOfferType: ExternalOfferType = offerType === "paid" && (priceAmount === undefined || !currency)
        ? "unknown"
        : offerType;
    const price = normalizedOfferType === "paid" && priceAmount !== undefined && currency
        ? `${priceAmount} ${currency}`
        : "";
    const catalogCategory = isCatalogCategoryId(data.catalogCategory) ? data.catalogCategory : undefined;
    const catalogSubcategory = catalogCategory && isCatalogSubcategoryId(catalogCategory, data.catalogSubcategory)
        ? data.catalogSubcategory
        : undefined;
    const location = data.location && typeof data.location === "object"
        ? data.location as Record<string, unknown>
        : undefined;
    const lat = location?.lat;
    const lng = location?.lng;
    const safeLocation = typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
        typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180
        ? { lat, lng }
        : undefined;
    const images = Array.isArray(data.images)
        ? data.images.filter(safeHttpsUrl).slice(0, 8)
        : undefined;

    return {
        id,
        isExternal: true,
        sourceId: data.sourceId,
        ...(typeof data.sourceName === "string" && data.sourceName.trim() ? { sourceName: data.sourceName.trim().slice(0, 120) } : {}),
        sourceListingId: data.sourceListingId,
        originalUrl: data.originalUrl,
        title: data.title.trim().slice(0, 300),
        ...(typeof data.description === "string" ? { description: data.description.slice(0, 15_000) } : {}),
        ...(isAdCategory(data.category) ? { category: data.category } : {}),
        ...(catalogCategory ? { catalogCategory } : {}),
        ...(catalogSubcategory ? { catalogSubcategory } : {}),
        ...(typeof data.voivodeship === "string" ? { voivodeship: data.voivodeship } : {}),
        ...(typeof data.city === "string" ? { city: data.city } : {}),
        price,
        ...(normalizedOfferType !== "unknown" ? { priceType: normalizedOfferType } : {}),
        offerType: normalizedOfferType,
        ...(normalizedOfferType === "paid" && priceAmount !== undefined && currency ? { priceAmount, currency } : {}),
        ...(images?.length ? { images } : {}),
        ...(safeLocation ? { location: safeLocation } : {}),
        createdAt,
        status: "active",
    };
}

export async function loadActiveExternalCatalogWindow(database: Firestore, telegramEnabled = true): Promise<{
    listings: ExternalCatalogListing[];
    mayHaveMore: boolean;
}> {
    const snapshot = await getDocs(query(
        collection(database, "externalAds"),
        where("status", "==", "active"),
        orderBy("lastSeenAt", "desc"),
        limit(EXTERNAL_CATALOG_WINDOW_SIZE),
    ));
    const listings = snapshot.docs
        .map((document) => mapExternalCatalogListing(document.id, document.data()))
        .filter((listing): listing is ExternalCatalogListing => listing !== null && shouldShowExternalSource(listing.sourceId, telegramEnabled));
    return { listings, mayHaveMore: snapshot.size === EXTERNAL_CATALOG_WINDOW_SIZE };
}

function createExternalCatalogQuery(
    database: Firestore,
    filters: CatalogFilterState,
    cursor: ExternalCatalogCursor | null,
    pageSize: number,
) {
    const constraints: QueryConstraint[] = [where("status", "==", "active")];
    if (filters.sort === "oldest") {
        constraints.push(orderBy("createdAt", "asc"));
    } else if (filters.sort === "priceAsc" || filters.sort === "priceDesc") {
        constraints.push(
            orderBy("priceSortGroup", "asc"),
            orderBy("priceSortAmount", filters.sort === "priceAsc" ? "asc" : "desc"),
            orderBy("createdAt", "desc"),
        );
    } else {
        constraints.push(orderBy("createdAt", "desc"));
    }
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(pageSize));
    return query(collection(database, "externalAds"), ...constraints);
}

export async function loadActiveExternalCatalogPage(
    database: Firestore,
    filters: CatalogFilterState,
    cursor: ExternalCatalogCursor | null = null,
    pageSize = EXTERNAL_CATALOG_PAGE_SIZE,
    telegramEnabled = true,
): Promise<ExternalCatalogPage> {
    const boundedPageSize = Math.min(Math.max(Math.floor(pageSize), 1), EXTERNAL_CATALOG_PAGE_SIZE);
    const matches: ExternalCatalogListing[] = [];
    let currentCursor = cursor;
    let scanned = 0;
    let hasMore = false;

    while (scanned < EXTERNAL_CATALOG_MAX_SCAN && matches.length < boundedPageSize) {
        const batchSize = Math.min(EXTERNAL_CATALOG_WINDOW_SIZE, EXTERNAL_CATALOG_MAX_SCAN - scanned);
        const snapshot = await getDocs(createExternalCatalogQuery(database, filters, currentCursor, batchSize));
        if (snapshot.empty) {
            hasMore = false;
            break;
        }

        const mapped = snapshot.docs
            .map((document) => mapExternalCatalogListing(document.id, document.data()))
            .filter((listing): listing is ExternalCatalogListing => listing !== null && shouldShowExternalSource(listing.sourceId, telegramEnabled));
        const matchingIds = new Set(filterAndSortAds(mapped, filters).map((listing) => listing.id));
        let consumed = 0;
        for (const document of snapshot.docs) {
            consumed++;
            scanned++;
            currentCursor = document;
            const listing = mapExternalCatalogListing(document.id, document.data());
            if (listing && shouldShowExternalSource(listing.sourceId, telegramEnabled) && matchingIds.has(listing.id)) matches.push(listing);
            if (matches.length >= boundedPageSize) break;
        }

        if (matches.length >= boundedPageSize) {
            hasMore = consumed < snapshot.size || snapshot.size === batchSize;
            break;
        }
        if (snapshot.size < batchSize) {
            hasMore = false;
            break;
        }
        hasMore = true;
    }

    const scanLimited = scanned >= EXTERNAL_CATALOG_MAX_SCAN && hasMore;
    return { listings: matches, cursor: currentCursor, hasMore, scanLimited };
}
