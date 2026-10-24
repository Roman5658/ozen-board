import assert from "node:assert/strict";
import test from "node:test";
import { mapExternalCatalogListing } from "../src/data/externalListings";
import { filterAndSortAds, type CatalogFilterState } from "../src/utils/catalogFilters";
import type { ExternalCatalogListing } from "../src/types/externalListing";

const baseRecord = {
    isExternal: true,
    sourceId: "synthetic-fixture",
    sourceName: "Synthetic test feed",
    sourceListingId: "fixture-1",
    originalUrl: "https://vendor.example/listings/1",
    title: "Test phone",
    description: "Synthetic electronics description",
    category: "sell",
    catalogCategory: "electronics",
    catalogSubcategory: "phonesComputers",
    voivodeship: "mazowieckie",
    city: "Warszawa",
    offerType: "paid",
    priceAmount: 450,
    currency: "PLN",
    createdAt: 1_800_000_000_000,
    importedAt: 1_800_000_000_000,
    lastSeenAt: 1_800_000_000_000,
    status: "active",
};

const noFilters: CatalogFilterState = {
    category: "all",
    catalogCategory: "all",
    catalogSubcategory: "",
    offerType: "all",
    voivodeship: "all",
    city: "",
    query: "",
    minPrice: "",
    maxPrice: "",
    sort: "newest",
};

test("external catalog mapping is read-only, validates URL and normalizes supported fields", () => {
    const listing = mapExternalCatalogListing("synthetic-fixture_hash", baseRecord);
    assert.ok(listing);
    assert.equal(listing.isExternal, true);
    assert.equal("userId" in listing, false);
    assert.equal(listing.price, "450 PLN");
    assert.equal(listing.sourceName, "Synthetic test feed");
    assert.deepEqual(listing.location, undefined);
    assert.equal(mapExternalCatalogListing("inactive", { ...baseRecord, status: "stale" }), null);
    assert.equal(mapExternalCatalogListing("unsafe", { ...baseRecord, originalUrl: "javascript:alert(1)" }), null);
});

test("external offers share category, keyword, offer-type, price and sort filters without mixing currencies", () => {
    const listings = [
        mapExternalCatalogListing("pln-450", baseRecord),
        mapExternalCatalogListing("pln-65", { ...baseRecord, sourceListingId: "fixture-2", title: "Lamp", priceAmount: 65 }),
        mapExternalCatalogListing("eur-250", { ...baseRecord, sourceListingId: "fixture-3", title: "Laptop EUR", priceAmount: 250, currency: "EUR" }),
        mapExternalCatalogListing("free", { ...baseRecord, sourceListingId: "fixture-4", title: "Free book", offerType: "free", priceAmount: undefined, currency: undefined }),
        mapExternalCatalogListing("unknown", { ...baseRecord, sourceListingId: "fixture-5", title: "Unknown price", offerType: "unknown", priceAmount: undefined, currency: undefined }),
    ].filter((listing): listing is ExternalCatalogListing => listing !== null);

    assert.deepEqual(filterAndSortAds(listings, {
        ...noFilters,
        offerType: "paid",
        catalogCategory: "electronics",
        minPrice: "100",
        maxPrice: "500",
    }).map((listing) => listing.id), ["pln-450"]);
    assert.deepEqual(filterAndSortAds(listings, { ...noFilters, offerType: "free" }).map((listing) => listing.id), ["free"]);
    assert.deepEqual(filterAndSortAds(listings, { ...noFilters, query: "phone synthetic electronics" }).map((listing) => listing.id), ["pln-450"]);
    assert.deepEqual(filterAndSortAds(listings, { ...noFilters, sort: "priceAsc" }).map((listing) => listing.id), ["pln-65", "pln-450", "eur-250", "free", "unknown"]);
});
