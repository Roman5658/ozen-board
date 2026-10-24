import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalListing, ExternalListingSource } from "../functions/src/imports/externalListings";
import {
    createPartnerJsonFeedAdapter,
    isExternalListingsEnabled,
    loadPartnerJsonFeedConfig,
    mapPartnerJsonFeedCandidate,
    mapPartnerJsonFeedPage,
    runPartnerJsonFeedImport,
    type PartnerJsonFeedConfig,
} from "../functions/src/imports/partnerJsonFeedAdapter";
import type { ExternalListingImportRepository, ImportRunResult } from "../functions/src/imports/runExternalListingImport";

const source: ExternalListingSource = {
    id: "licensed-partner",
    displayName: "Licensed Partner Feed",
    allowedListingHosts: ["vendor.example"],
    allowedImageHosts: ["images.vendor.example"],
    rights: {
        reference: "https://vendor.example/terms/syndication",
        reviewedAt: 1_800_000_000_000,
        permissionConfirmed: true,
        fields: ["title", "originalUrl", "description", "price", "category", "location", "images", "publishedAt", "status"],
    },
    categoryMappings: {
        electronics: { category: "sell", catalogCategory: "electronics", catalogSubcategory: "phonesComputers" },
    },
};

const config: PartnerJsonFeedConfig = {
    enabled: true,
    endpoint: "https://feed.vendor.example/api/listings",
    allowedFeedHosts: ["feed.vendor.example"],
    source,
    providesCompleteSnapshot: false,
};

test("external import feature switch is opt-in and disabled config avoids feed requirements", () => {
    assert.equal(isExternalListingsEnabled(undefined), false);
    assert.equal(isExternalListingsEnabled("false"), false);
    assert.equal(isExternalListingsEnabled("true"), true);
    assert.equal(loadPartnerJsonFeedConfig({ EXTERNAL_LISTINGS_ENABLED: "false" }), null);
    assert.throws(() => loadPartnerJsonFeedConfig({ EXTERNAL_LISTINGS_ENABLED: "true" }), /missing-external-listings-feed-url/);
});

test("partner feed adapter pins the endpoint and maps only canonical listing fields", async () => {
    let requestedUrl = "";
    let requestedToken = "";
    const adapter = createPartnerJsonFeedAdapter({ ...config, bearerToken: "server-only-token" }, async (url, hosts, _signal, options) => {
        requestedUrl = url;
        assert.deepEqual(hosts, ["feed.vendor.example"]);
        requestedToken = options?.bearerToken ?? "";
        return {
            items: [{
                sourceListingId: "ad-42",
                originalUrl: "https://vendor.example/listings/42#top",
                title: "Synthetic licensed feed record",
                offerType: "free",
                sourceCategory: "electronics",
                userId: "must-not-be-copied",
            }],
            hasMore: false,
        };
    });
    const page = await adapter.fetchPage("opaque-cursor", 20, new AbortController().signal);
    const requested = new URL(requestedUrl);
    assert.equal(requested.origin + requested.pathname, "https://feed.vendor.example/api/listings");
    assert.equal(requested.searchParams.get("limit"), "20");
    assert.equal(requested.searchParams.get("cursor"), "opaque-cursor");
    assert.equal(requestedToken, "server-only-token");
    assert.equal(page.items.length, 1);
    const candidate = mapPartnerJsonFeedCandidate(page.items[0]);
    assert.equal(candidate.originalUrl, "https://vendor.example/listings/42#top");
    assert.equal("userId" in candidate, false);
});

test("partner feed schema rejects missing or unsafe cursors and malformed pages", () => {
    assert.throws(() => mapPartnerJsonFeedPage({ items: [], hasMore: true }), /invalid-partner-feed-cursor/);
    assert.throws(() => mapPartnerJsonFeedPage({ items: [], hasMore: true, nextCursor: "bad\ncursor" }), /invalid-partner-feed-cursor/);
    assert.throws(() => mapPartnerJsonFeedPage({ items: "not-an-array", hasMore: false }), /invalid-partner-feed-page/);
    assert.throws(() => createPartnerJsonFeedAdapter({ ...config, endpoint: "https://attacker.example/feed" }), /unsafe-feed-endpoint/);
});

class MemoryRepository implements ExternalListingImportRepository {
    listings = new Map<string, ExternalListing>();
    finished: ImportRunResult | undefined;
    async acquireLock(): Promise<boolean> { return true; }
    async renewLock(): Promise<boolean> { return true; }
    async startRun(): Promise<void> {}
    async upsertListing(listing: ExternalListing): Promise<"created" | "updated" | "duplicate" | "limited"> {
        const exists = this.listings.has(listing.id);
        this.listings.set(listing.id, listing);
        return exists ? "updated" : "created";
    }
    async markMissingAsStale(): Promise<{ marked: number; scanLimited: boolean }> { return { marked: 0, scanLimited: false }; }
    async finishRun(result: ImportRunResult): Promise<void> { this.finished = result; }
    async releaseLock(): Promise<void> {}
}

test("configured partner import is disabled without network access and caps an enabled run at 20 rows", async () => {
    const previousEnabled = process.env.EXTERNAL_LISTINGS_ENABLED;
    const repository = new MemoryRepository();
    let fetchCount = 0;
    const fetcher = async () => {
        fetchCount++;
        return {
            items: Array.from({ length: 30 }, (_, index) => ({
                sourceListingId: `ad-${index + 1}`,
                originalUrl: `https://vendor.example/listings/${index + 1}`,
                title: `Synthetic record ${index + 1}`,
                sourceCategory: "electronics",
                offerType: "free",
                sourceStatus: "active",
            })),
            hasMore: true,
            nextCursor: "page-2",
        };
    };

    try {
        delete process.env.EXTERNAL_LISTINGS_ENABLED;
        assert.equal(await runPartnerJsonFeedImport(config, repository, {}, fetcher), null);
        assert.equal(fetchCount, 0);

        process.env.EXTERNAL_LISTINGS_ENABLED = "true";
        const result = await runPartnerJsonFeedImport(config, repository, {
            maxRecords: 500,
            pageSize: 100,
            now: () => 1_800_000_000_000,
            createRunId: () => "bounded-run",
        }, fetcher);
        assert.equal(result?.status, "partial");
        assert.equal(result?.received, 20);
        assert.equal(result?.created, 20);
        assert.equal(repository.listings.size, 20);
        assert.equal(fetchCount, 1);
    } finally {
        if (previousEnabled === undefined) delete process.env.EXTERNAL_LISTINGS_ENABLED;
        else process.env.EXTERNAL_LISTINGS_ENABLED = previousEnabled;
    }
});
