import { readFile } from "node:fs/promises";
import type { ExternalListingCandidate, ExternalListingSource } from "../functions/src/imports/externalListings";
import type { ExternalListingAdapter, ExternalListingPage } from "../functions/src/imports/runExternalListingImport";

export const fixtureSource: ExternalListingSource = {
    id: "synthetic-fixture",
    displayName: "Synthetic test feed",
    allowedListingHosts: ["vendor.example"],
    allowedImageHosts: [],
    rights: {
        // This record exists only to exercise the importer's rights gate in isolated tests.
        reference: "https://vendor.example.invalid/synthetic-test-only",
        reviewedAt: 1_700_000_000_000,
        permissionConfirmed: true,
        fields: ["title", "originalUrl", "description", "price", "category", "location", "publishedAt"],
    },
    categoryMappings: {
        electronics: { category: "sell", catalogCategory: "electronics", catalogSubcategory: "phonesComputers" },
        other: { category: "sell", catalogCategory: "other", catalogSubcategory: "miscellaneous" },
        furniture: { category: "sell", catalogCategory: "furniture", catalogSubcategory: "furniture" },
        clothing: { category: "sell", catalogCategory: "clothing", catalogSubcategory: "accessories" },
        transport: { category: "sell", catalogCategory: "transport", catalogSubcategory: "cars" },
        garden: { category: "sell", catalogCategory: "garden", catalogSubcategory: "plants" },
        children: { category: "sell", catalogCategory: "children", catalogSubcategory: "toys" },
        construction: { category: "sell", catalogCategory: "construction", catalogSubcategory: "bricksTools" },
        service: { category: "service", catalogCategory: "other", catalogSubcategory: "miscellaneous" },
    },
};

export async function loadExternalListingFixtureRows(
    fixtureUrl: URL = new URL("./fixtures/external-listings.json", import.meta.url),
): Promise<ExternalListingCandidate[]> {
    const parsed: unknown = JSON.parse(await readFile(fixtureUrl, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("fixture-must-be-an-array");
    return parsed as ExternalListingCandidate[];
}

export function createExternalListingFixtureAdapter(rows: readonly ExternalListingCandidate[]): ExternalListingAdapter {

    return {
        source: fixtureSource,
        providesCompleteSnapshot: true,
        async fetchPage(cursor, pageSize, signal): Promise<ExternalListingPage> {
            if (signal.aborted) throw new Error("fixture-fetch-aborted");
            const offset = cursor === undefined ? 0 : Number(cursor);
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > rows.length) {
                throw new Error("invalid-fixture-cursor");
            }
            const end = Math.min(offset + pageSize, rows.length);
            return {
                items: rows.slice(offset, end),
                hasMore: end < rows.length,
                ...(end < rows.length ? { nextCursor: String(end) } : {}),
            };
        },
        mapCandidate(value) {
            if (!value || typeof value !== "object" || Array.isArray(value)) {
                throw new Error("invalid-fixture-row");
            }
            const row = value as ExternalListingCandidate;
            const sourceListingId = typeof row.sourceListingId === "string" ? row.sourceListingId : "invalid";
            return {
                ...row,
                originalUrl: row.originalUrl ?? `https://vendor.example/listings/${encodeURIComponent(sourceListingId)}`,
            };
        },
    };
}

export async function loadExternalListingFixtureAdapter(
    fixtureUrl: URL = new URL("./fixtures/external-listings.json", import.meta.url),
): Promise<ExternalListingAdapter> {
    return createExternalListingFixtureAdapter(await loadExternalListingFixtureRows(fixtureUrl));
}
