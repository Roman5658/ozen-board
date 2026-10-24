import type { Ad } from "./ad";

export type ExternalOfferType = "paid" | "free" | "exchange" | "unknown";

/** Public catalog representation; it deliberately has no userId or owner actions. */
export type ExternalCatalogListing = {
    id: string;
    isExternal: true;
    userId?: never;
    sourceId: string;
    sourceName?: string;
    sourceListingId: string;
    originalUrl: string;
    title: string;
    description?: string;
    category?: Ad["category"];
    catalogCategory?: Ad["catalogCategory"];
    catalogSubcategory?: Ad["catalogSubcategory"];
    voivodeship?: string;
    city?: string;
    price: string;
    priceType?: "paid" | "free" | "exchange";
    offerType: ExternalOfferType;
    priceAmount?: number;
    currency?: string;
    images?: string[];
    location?: Ad["location"];
    createdAt: number;
    status: "active";
    // External records are never promoted or bumped through the user billing system.
    pinType?: undefined;
    pinnedAt?: undefined;
    pinnedUntil?: undefined;
    pinQueueAt?: undefined;
    bumpAt?: undefined;
    highlightUntil?: undefined;
    highlightType?: undefined;
};

export type CatalogListing = Ad | ExternalCatalogListing;

export function isExternalCatalogListing(listing: CatalogListing): listing is ExternalCatalogListing {
    return (listing as ExternalCatalogListing).isExternal === true;
}
