import { resolveAdPriceType } from "./adPrice";
import { resolveCatalogCategory, type CatalogCategoryFilter } from "../data/catalogCategories";

export type OfferTypeFilter = "all" | "paid" | "free" | "exchange";
export type CatalogSortOrder = "newest" | "oldest" | "priceAsc" | "priceDesc";

export type CatalogFilterState = {
    category: "all" | "work" | "buy" | "sell" | "service" | "rent";
    catalogCategory: CatalogCategoryFilter;
    catalogSubcategory: string;
    offerType: OfferTypeFilter;
    voivodeship: string;
    city: string;
    query: string;
    minPrice: string;
    maxPrice: string;
    sort: CatalogSortOrder;
};

export type CatalogFilterableListing = {
    id: string;
    title?: string;
    description?: string;
    category?: string;
    catalogCategory?: string;
    catalogSubcategory?: string;
    voivodeship?: string;
    city?: string;
    price: string | number;
    priceType?: unknown;
    offerType?: "paid" | "free" | "exchange" | "unknown";
    currency?: string;
    isExternal?: boolean;
    createdAt: number;
};

export type PriceBoundResult = { value: number | null; error: "invalid" | null };

export function parsePriceBound(input: string): PriceBoundResult {
    const value = input.trim();
    if (!value) return { value: null, error: null };
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) return { value: null, error: "invalid" };
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? { value: parsed, error: null } : { value: null, error: "invalid" };
}

/** Accepts the numeric price forms used by the current and legacy records. */
export function parseAdPriceAmount(value: unknown): number | null {
    if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
    if (typeof value !== "string") return null;

    const text = value.trim();
    const match = text.match(/^(\d+(?:[.,]\d{1,2})?)(?:\s*(?:zł|pln))?(?:\s*\/\s*[\p{L}].*)?$/iu);
    if (!match) return null;
    const amount = Number(match[1].replace(",", "."));
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function normalizeSearchText(value: unknown): string {
    if (typeof value !== "string") return "";
    return value
        .toLocaleLowerCase()
        .replace(/[ł]/g, "l")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

function compareByDate(left: CatalogFilterableListing, right: CatalogFilterableListing, direction: 1 | -1): number {
    const leftTime = Number.isFinite(left.createdAt) ? left.createdAt : 0;
    const rightTime = Number.isFinite(right.createdAt) ? right.createdAt : 0;
    return (leftTime - rightTime) * direction || left.id.localeCompare(right.id);
}

export function filterAndSortAds<T extends CatalogFilterableListing>(ads: readonly T[], filters: CatalogFilterState): T[] {
    const minResult = parsePriceBound(filters.minPrice);
    const maxResult = parsePriceBound(filters.maxPrice);
    if (minResult.error || maxResult.error) return [];
    if (minResult.value !== null && maxResult.value !== null && minResult.value > maxResult.value) return [];

    const queryTokens = normalizeSearchText(filters.query).split(/\s+/).filter(Boolean);
    const filtered = ads.filter((ad) => {
        if (filters.category !== "all" && ad.category !== filters.category) return false;
        if (filters.voivodeship !== "all" && ad.voivodeship !== filters.voivodeship) return false;
        if (filters.city && ad.city !== filters.city) return false;

        const priceType = ad.isExternal ? ad.offerType ?? "unknown" : resolveAdPriceType(ad.priceType);
        if (filters.offerType !== "all" && filters.offerType !== priceType) return false;

        const adCatalogCategory = resolveCatalogCategory(ad.catalogCategory);
        if (filters.catalogCategory === "uncategorized" && adCatalogCategory) return false;
        if (filters.catalogCategory !== "all" && filters.catalogCategory !== "uncategorized" &&
            adCatalogCategory !== filters.catalogCategory) return false;
        if (filters.catalogSubcategory && ad.catalogSubcategory !== filters.catalogSubcategory) return false;

        if (minResult.value !== null || maxResult.value !== null) {
            if (priceType !== "paid") return false;
            // External prices in other currencies must never be compared to PLN bounds.
            if (ad.isExternal && ad.currency !== "PLN") return false;
            const amount = parseAdPriceAmount(ad.price);
            if (amount === null) return false;
            if (minResult.value !== null && amount < minResult.value) return false;
            if (maxResult.value !== null && amount > maxResult.value) return false;
        }

        if (queryTokens.length) {
            const searchableText = normalizeSearchText(`${ad.title ?? ""} ${ad.description ?? ""}`);
            if (!queryTokens.every((token) => searchableText.includes(token))) return false;
        }

        return true;
    });

    return filtered.sort((left, right) => {
        if (filters.sort === "oldest") return compareByDate(left, right, 1);
        if (filters.sort === "priceAsc" || filters.sort === "priceDesc") {
            const leftType = left.isExternal ? left.offerType : resolveAdPriceType(left.priceType);
            const rightType = right.isExternal ? right.offerType : resolveAdPriceType(right.priceType);
            const leftPrice = leftType === "paid" && (!left.isExternal || left.currency === "PLN") ? parseAdPriceAmount(left.price) : null;
            const rightPrice = rightType === "paid" && (!right.isExternal || right.currency === "PLN") ? parseAdPriceAmount(right.price) : null;
            if (leftPrice === null && rightPrice !== null) return 1;
            if (leftPrice !== null && rightPrice === null) return -1;
            if (leftPrice !== null && rightPrice !== null && leftPrice !== rightPrice) {
                return (leftPrice - rightPrice) * (filters.sort === "priceAsc" ? 1 : -1);
            }
        }
        return compareByDate(left, right, -1);
    });
}
