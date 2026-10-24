import assert from "node:assert/strict";
import test from "node:test";
import type { Ad } from "../src/types/ad";
import { filterAndSortAds, parseAdPriceAmount, parsePriceBound } from "../src/utils/catalogFilters";

function ad(overrides: Partial<Ad> & Pick<Ad, "id" | "title">): Ad {
    return {
        description: "",
        category: "sell",
        city: "Warszawa",
        voivodeship: "mazowieckie",
        price: "100",
        createdAt: 1,
        userId: "test-user",
        ...overrides,
    };
}

const baseFilters = {
    category: "all" as const,
    catalogCategory: "all" as const,
    catalogSubcategory: "",
    offerType: "all" as const,
    voivodeship: "all",
    city: "",
    query: "",
    minPrice: "",
    maxPrice: "",
    sort: "newest" as const,
};

test("combines offer and catalog category filters and keeps legacy ads paid", () => {
    const ads = [
        ad({ id: "legacy", title: "Stare", price: "100 zł" }),
        ad({ id: "free-animal", title: "Pies", price: "", priceType: "free", catalogCategory: "animals", catalogSubcategory: "dogsCats" }),
        ad({ id: "exchange-electronics", title: "Telefon", price: "", priceType: "exchange", catalogCategory: "electronics", catalogSubcategory: "phonesComputers" }),
    ];

    assert.deepEqual(
        filterAndSortAds(ads, { ...baseFilters, offerType: "free", catalogCategory: "animals" }).map(({ id }) => id),
        ["free-animal"],
    );
    assert.deepEqual(
        filterAndSortAds(ads, { ...baseFilters, offerType: "exchange", catalogCategory: "electronics" }).map(({ id }) => id),
        ["exchange-electronics"],
    );
    assert.deepEqual(
        filterAndSortAds(ads, { ...baseFilters, offerType: "paid", catalogCategory: "uncategorized" }).map(({ id }) => id),
        ["legacy"],
    );
});

test("category, text search, price bounds, and price ordering combine", () => {
    const ads = [
        ad({ id: "a", title: "Telefon Łódź", description: "Sprzedam telefon używany", price: "500 zł", catalogCategory: "electronics", catalogSubcategory: "phonesComputers", createdAt: 10 }),
        ad({ id: "b", title: "Telefon", description: "Nowy model", price: "50 zł", catalogCategory: "electronics", catalogSubcategory: "phonesComputers", createdAt: 20 }),
        ad({ id: "c", title: "Telefon bez ceny", price: "do uzgodnienia", catalogCategory: "electronics", catalogSubcategory: "phonesComputers", createdAt: 30 }),
        ad({ id: "d", title: "Rower", price: "100 zł", catalogCategory: "transport", createdAt: 40 }),
    ];

    const results = filterAndSortAds(ads, {
        ...baseFilters,
        category: "sell",
        catalogCategory: "electronics",
        catalogSubcategory: "phonesComputers",
        query: "telefon lodz",
        minPrice: "50",
        maxPrice: "500",
        sort: "priceAsc",
    });
    assert.deepEqual(results.map(({ id }) => id), ["a"]);

    const priceRangeResults = filterAndSortAds(ads, {
        ...baseFilters,
        catalogCategory: "electronics",
        minPrice: "50",
        maxPrice: "500",
        sort: "priceAsc",
    });
    assert.deepEqual(priceRangeResults.map(({ id }) => id), ["b", "a"]);
});

test("range filters reject invalid bounds and exclude free, exchange, and unpriced legacy ads", () => {
    const ads = [
        ad({ id: "paid", title: "Paid", price: "30" }),
        ad({ id: "free", title: "Free", price: "", priceType: "free" }),
        ad({ id: "exchange", title: "Exchange", price: "", priceType: "exchange" }),
        ad({ id: "legacy-no-price", title: "Legacy", price: "" }),
    ];

    assert.deepEqual(filterAndSortAds(ads, { ...baseFilters, minPrice: "20" }).map(({ id }) => id), ["paid"]);
    assert.deepEqual(filterAndSortAds(ads, { ...baseFilters, maxPrice: "30" }).map(({ id }) => id), ["paid"]);
    assert.deepEqual(filterAndSortAds(ads, { ...baseFilters, minPrice: "20", maxPrice: "10" }), []);
    assert.deepEqual(filterAndSortAds(ads, { ...baseFilters, minPrice: "-1" }), []);
    assert.deepEqual(filterAndSortAds(ads, { ...baseFilters, maxPrice: "NaN" }), []);
    assert.equal(parsePriceBound("Infinity").error, "invalid");
});

test("date and price sorts are stable and leave nonnumeric offers after priced ads", () => {
    const ads = [
        ad({ id: "newer", title: "Newer", price: "100", createdAt: 10 }),
        ad({ id: "cheaper", title: "Cheaper", price: "20", createdAt: 5 }),
        ad({ id: "no-price", title: "No price", price: "by agreement", createdAt: 20 }),
        ad({ id: "free", title: "Free", price: "", priceType: "free", createdAt: 30 }),
        ad({ id: "equal", title: "Equal", price: "20", createdAt: 7 }),
    ];

    assert.deepEqual(filterAndSortAds(ads, { ...baseFilters, sort: "newest" }).map(({ id }) => id), ["free", "no-price", "newer", "equal", "cheaper"]);
    assert.deepEqual(filterAndSortAds(ads, { ...baseFilters, sort: "oldest" }).map(({ id }) => id), ["cheaper", "equal", "newer", "no-price", "free"]);
    assert.deepEqual(filterAndSortAds(ads, { ...baseFilters, sort: "priceAsc" }).map(({ id }) => id), ["equal", "cheaper", "newer", "free", "no-price"]);
    assert.deepEqual(filterAndSortAds(ads, { ...baseFilters, sort: "priceDesc" }).map(({ id }) => id), ["newer", "equal", "cheaper", "free", "no-price"]);
});

test("legacy and incomplete records are safe, searchable in descriptions, and numeric parsing rejects unsafe values", () => {
    const oldAd = ad({ id: "old", title: "Ogłoszenie", description: "Piękny rower для міста", createdAt: 2 });
    const missingCategory = { ...oldAd, id: "missing-category", category: undefined } as unknown as Ad;
    const ads = [oldAd, missingCategory];

    assert.equal(filterAndSortAds(ads, { ...baseFilters, query: "Piekny miasta" }).length, 0);
    assert.deepEqual(filterAndSortAds(ads, { ...baseFilters, query: "piękny" }).map(({ id }) => id), ["missing-category", "old"]);
    assert.equal(filterAndSortAds(ads, { ...baseFilters, category: "sell" }).length, 1);
    assert.equal(filterAndSortAds(ads, { ...baseFilters, catalogCategory: "uncategorized" }).length, 2);

    assert.equal(parseAdPriceAmount("25 zł/год"), 25);
    assert.equal(parseAdPriceAmount("1e3"), null);
    assert.equal(parseAdPriceAmount("-5"), null);
    assert.equal(parseAdPriceAmount("NaN"), null);
    assert.equal(parseAdPriceAmount("Infinity"), null);
    assert.equal(parseAdPriceAmount(Number.POSITIVE_INFINITY), null);
    assert.equal(parseAdPriceAmount(null), null);
});
