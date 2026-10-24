import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    ExternalListingValidationError,
    createExternalListingDocumentId,
    normalizeExternalListing,
    type ExternalListing,
    type ExternalListingCandidate,
    type ExternalListingSource,
} from "../functions/src/imports/externalListings";
import {
    runExternalListingImport,
    type ExternalListingAdapter,
    type ExternalListingImportRepository,
    type ImportRunResult,
} from "../functions/src/imports/runExternalListingImport";
import { loadExternalListingFixtureAdapter } from "./externalListingFixtureAdapter";

const source: ExternalListingSource = {
    id: "licensed-vendor",
    allowedListingHosts: ["vendor.example"],
    allowedImageHosts: ["cdn.vendor.example"],
    rights: {
        reference: "https://vendor.example/terms/feed-license",
        reviewedAt: 1_700_000_000_000,
        permissionConfirmed: true,
        fields: ["title", "originalUrl", "description", "price", "category", "location", "images", "publishedAt"],
    },
    categoryMappings: {
        "vendor-electronics": { category: "sell", catalogCategory: "electronics", catalogSubcategory: "phonesComputers" },
    },
};

function candidate(overrides: Partial<ExternalListingCandidate> = {}): ExternalListingCandidate {
    return {
        sourceListingId: "vendor-42",
        originalUrl: "https://vendor.example/listings/42",
        title: "  Phone\t for sale  ",
        description: "A licensed   description.\n  Second line.",
        sourceCategory: "vendor-electronics",
        offerType: "paid",
        priceAmount: 450,
        currency: "pln",
        city: "Warszawa",
        location: { lat: 52.2297, lng: 21.0122 },
        images: ["https://cdn.vendor.example/phone.jpg", "http://vendor.example/nope.jpg", "https://elsewhere.example/nope.jpg"],
        sourcePublishedAt: 1_700_000_000_100,
        ...overrides,
    };
}

test("normalizes an allowed paid listing, category, location, and licensed image", () => {
    const listing = normalizeExternalListing(candidate(), source, 1_700_000_001_000);
    assert.equal(listing.isExternal, true);
    assert.equal("userId" in listing, false);
    assert.equal("pinType" in listing, false);
    assert.equal("paymentId" in listing, false);
    assert.equal(listing.offerType, "paid");
    assert.equal(listing.priceAmount, 450);
    assert.equal(listing.currency, "PLN");
    assert.equal(listing.category, "sell");
    assert.equal(listing.catalogSubcategory, "phonesComputers");
    assert.deepEqual(listing.location, { lat: 52.2297, lng: 21.0122 });
    assert.deepEqual(listing.images, ["https://cdn.vendor.example/phone.jpg"]);
    assert.equal(listing.title, "Phone for sale");
    assert.equal(listing.description, "A licensed description.\nSecond line.");
});

test("missing price remains unknown instead of becoming zero", () => {
    const listing = normalizeExternalListing(candidate({ offerType: undefined, priceAmount: undefined, currency: undefined }), source, 1_700_000_001_000);
    assert.equal(listing.offerType, "unknown");
    assert.equal(listing.priceAmount, undefined);
    assert.equal(listing.currency, undefined);
});

test("does not silently accept malformed implicit prices", () => {
    for (const priceAmount of [-1, Number.NaN, Number.NEGATIVE_INFINITY, "12"]) {
        assert.throws(
            () => normalizeExternalListing(candidate({ offerType: undefined, priceAmount, currency: "PLN" }), source, 1_700_000_001_000),
            /invalid-price/,
        );
    }
});

test("free and exchange offers do not retain a stale price", () => {
    const free = normalizeExternalListing(candidate({ offerType: "free", priceAmount: 450, currency: "PLN" }), source, 1_700_000_001_000);
    const exchange = normalizeExternalListing(candidate({ offerType: "exchange", priceAmount: 450, currency: "PLN" }), source, 1_700_000_001_000);
    assert.equal(free.offerType, "free");
    assert.equal(free.priceAmount, undefined);
    assert.equal(exchange.offerType, "exchange");
    assert.equal(exchange.priceAmount, undefined);
});

test("a licensed source status marks removed offers stale and rejects unknown source statuses", () => {
    const statusSource = { ...source, rights: { ...source.rights, fields: [...source.rights.fields, "status"] as const } };
    const stale = normalizeExternalListing(candidate({ sourceStatus: "stale" }), statusSource, 1_700_000_001_000);
    assert.equal(stale.status, "stale");
    assert.throws(() => normalizeExternalListing(candidate({ sourceStatus: "deleted" }), statusSource, 1_700_000_001_000), /invalid-source-status/);
});

test("rejects invalid paid prices and offer types", () => {
    for (const priceAmount of [-1, Number.NaN, Number.POSITIVE_INFINITY, "100"]) {
        assert.throws(
            () => normalizeExternalListing(candidate({ priceAmount }), source, 1_700_000_001_000),
            ExternalListingValidationError,
        );
    }
    assert.throws(
        () => normalizeExternalListing(candidate({ currency: "US dollars" }), source, 1_700_000_001_000),
        /invalid-price/,
    );
    assert.throws(
        () => normalizeExternalListing(candidate({ offerType: "unknown-ish" }), source, 1_700_000_001_000),
        /invalid-offer-type/,
    );
});

test("unknown category needs review and unsafe original URLs are rejected", () => {
    const listing = normalizeExternalListing(candidate({ sourceCategory: "not-mapped" }), source, 1_700_000_001_000);
    assert.equal(listing.importStatus, "needs_review");
    assert.equal(listing.status, "review");
    assert.equal(listing.category, undefined);
    for (const originalUrl of ["http://vendor.example/a", "https://localhost/a", "https://attacker.example/a", "https://user:pass@vendor.example/a"]) {
        assert.throws(
            () => normalizeExternalListing(candidate({ originalUrl }), source, 1_700_000_001_000),
            /unsafe-original-url/,
        );
    }
});

test("invalid catalog mappings are dropped instead of creating new categories", () => {
    const invalidMappingSource = {
        ...source,
        categoryMappings: {
            ...source.categoryMappings,
            "vendor-electronics": { category: "sell" as const, catalogCategory: "arbitrary", catalogSubcategory: "made-up" },
        },
    };
    const listing = normalizeExternalListing(candidate(), invalidMappingSource, 1_700_000_001_000);
    assert.equal(listing.catalogCategory, undefined);
    assert.equal(listing.catalogSubcategory, undefined);
});

test("requires an explicit reviewed content-rights record", () => {
    const noRights = { ...source, rights: { ...source.rights, fields: [] } };
    assert.throws(() => normalizeExternalListing(candidate(), noRights, 1_700_000_001_000), /source-rights-not-reviewed/);
    const unconfirmedRights = { ...source, rights: { ...source.rights, permissionConfirmed: false } };
    assert.throws(() => normalizeExternalListing(candidate(), unconfirmedRights, 1_700_000_001_000), /source-rights-not-reviewed/);
});

test("does not retain fields without an explicit field permission", () => {
    const limitedSource = {
        ...source,
        rights: { ...source.rights, fields: ["title", "originalUrl"] as const },
    };
    const listing = normalizeExternalListing(candidate(), limitedSource, 1_700_000_001_000);
    assert.equal(listing.description, undefined);
    assert.equal(listing.offerType, "unknown");
    assert.equal(listing.sourceCategory, undefined);
    assert.equal(listing.city, undefined);
    assert.equal(listing.location, undefined);
    assert.equal(listing.images, undefined);
    assert.equal(listing.sourcePublishedAt, undefined);
});

test("source record ids map to deterministic, source-scoped document ids", () => {
    assert.equal(createExternalListingDocumentId("licensed-vendor", "vendor-42"), createExternalListingDocumentId("licensed-vendor", "vendor-42"));
    assert.notEqual(createExternalListingDocumentId("licensed-vendor", "vendor-42"), createExternalListingDocumentId("other-vendor", "vendor-42"));
});

test("listing URLs are canonicalized and hashed without fragments or host-case variants", () => {
    const canonical = normalizeExternalListing(candidate({ originalUrl: "https://vendor.example/listings/42" }), source, 1_700_000_001_000);
    const variant = normalizeExternalListing(candidate({ originalUrl: "https://VENDOR.example:443/listings/42#details" }), source, 1_700_000_001_000);
    assert.equal(variant.originalUrl, canonical.originalUrl);
    assert.equal(variant.normalizedUrlHash, canonical.normalizedUrlHash);
});

test("synthetic JSON feed uses the production importer interface with duplicates and malformed rows", async () => {
    const repository = new MemoryRepository();
    const fixtureAdapter = await loadExternalListingFixtureAdapter();
    const result = await runExternalListingImport(fixtureAdapter, repository, {
        now: () => 1_800_000_000_000,
        createRunId: () => "fixture-run",
        pageSize: 7,
    });

    assert.equal(result.status, "complete");
    assert.equal(result.created, 20);
    assert.equal(result.duplicates, 1);
    assert.equal(result.skipped, 1);
    assert.equal(repository.listings.size, 20);
    assert.equal(repository.listings.get(createExternalListingDocumentId("synthetic-fixture", "fixture-001"))?.priceAmount, 450);
    assert.equal(repository.listings.get(createExternalListingDocumentId("synthetic-fixture", "fixture-017"))?.status, "review");
});

test("optional skipped-record diagnostics do not change import results", async () => {
    const repository = new MemoryRepository();
    let observedError: unknown;
    const invalidAdapter: ExternalListingAdapter = {
        ...adapter([{ items: [{ synthetic: true }], hasMore: false }]),
        mapCandidate() {
            throw new Error("empty-telegram-description");
        },
    };

    const result = await runExternalListingImport(invalidAdapter, repository, {
        now: () => 1_700_000_002_000,
        createRunId: () => "skip-diagnostics",
        onRecordSkipped: (error) => { observedError = error; },
    });

    assert.equal(result.status, "complete");
    assert.equal(result.skipped, 1);
    assert.equal(result.created, 0);
    assert.equal(observedError instanceof Error ? observedError.message : "", "empty-telegram-description");
    assert.equal(repository.listings.size, 0);
});

test("a repository creation limit returns a partial retryable run", async () => {
    const repository = new MemoryRepository();
    repository.upsertListing = async () => "limited";
    const result = await runExternalListingImport(adapter([
        { items: [candidate()], hasMore: false },
    ]), repository, { now: () => 1_800_000_000_000, createRunId: () => "quota-limited-run" });

    assert.equal(result.status, "partial");
    assert.equal(result.errorCode, "daily-creation-limit-reached");
    assert.equal(result.skipped, 1);
    assert.equal(result.created, 0);
});

class MemoryRepository implements ExternalListingImportRepository {
    lockRunId: string | undefined;
    lockedUntil = 0;
    listings = new Map<string, ExternalListing>();
    runs: ImportRunResult[] = [];

    async acquireLock(_sourceId: string, runId: string, now: number, lockMs: number): Promise<boolean> {
        if (this.lockRunId && this.lockedUntil > now) return false;
        this.lockRunId = runId;
        this.lockedUntil = now + lockMs;
        return true;
    }

    async renewLock(_sourceId: string, runId: string, now: number, lockMs: number): Promise<boolean> {
        if (this.lockRunId !== runId || this.lockedUntil <= now) return false;
        this.lockedUntil = now + lockMs;
        return true;
    }

    async startRun(): Promise<void> {}

    async upsertListing(listing: ExternalListing, runId?: string, now?: number): Promise<"created" | "updated" | "duplicate" | "limited"> {
        if (runId && (this.lockRunId !== runId || this.lockedUntil <= (now ?? Date.now()))) {
            throw new Error("source-lock-lost");
        }
        const sameUrl = [...this.listings.values()].some((existing) =>
            existing.sourceId === listing.sourceId && existing.normalizedUrlHash === listing.normalizedUrlHash && existing.id !== listing.id,
        );
        if (sameUrl) return "duplicate";
        const existing = this.listings.get(listing.id);
        this.listings.set(listing.id, { ...existing, ...listing, importedAt: existing?.importedAt ?? listing.importedAt });
        return existing ? "updated" : "created";
    }

    async markMissingAsStale(sourceId: string, seenAt: number, _maxRecords: number, runId?: string, now?: number): Promise<{ marked: number; scanLimited: boolean }> {
        if (runId && (this.lockRunId !== runId || this.lockedUntil <= (now ?? Date.now()))) {
            throw new Error("source-lock-lost");
        }
        let marked = 0;
        for (const [id, listing] of this.listings) {
            if (listing.sourceId === sourceId && (listing.status === "active" || listing.status === "review") && listing.lastSeenAt < seenAt) {
                this.listings.set(id, { ...listing, status: "stale" });
                marked++;
            }
        }
        return { marked, scanLimited: false };
    }

    async finishRun(result: ImportRunResult): Promise<void> {
        this.runs.push(result);
    }

    async releaseLock(_sourceId: string, runId: string): Promise<void> {
        if (this.lockRunId === runId) this.lockRunId = undefined;
    }
}

function adapter(pages: readonly { items: readonly unknown[]; hasMore: boolean; nextCursor?: string }[], snapshot = true): ExternalListingAdapter {
    let pageIndex = 0;
    return {
        source,
        providesCompleteSnapshot: snapshot,
        async fetchPage() {
            const page = pages[pageIndex++];
            if (!page) throw new Error("no more pages");
            return page;
        },
        mapCandidate(value) {
            return value as ExternalListingCandidate;
        },
    };
}

test("complete import deduplicates records and is idempotent on repeat runs", async () => {
    const repository = new MemoryRepository();
    const repeated = candidate();
    const first = await runExternalListingImport(adapter([
        { items: [repeated], hasMore: true, nextCursor: "next-page" },
        { items: [repeated, candidate({ sourceListingId: "vendor-43", originalUrl: "https://vendor.example/listings/43" })], hasMore: false },
    ]), repository, { now: () => 1_700_000_002_000, createRunId: () => "run-1" });
    assert.equal(first.status, "complete");
    assert.equal(first.created, 2);
    assert.equal(first.duplicates, 1);
    assert.equal(repository.listings.size, 2);

    const second = await runExternalListingImport(adapter([
        { items: [repeated, candidate({ sourceListingId: "vendor-43", originalUrl: "https://vendor.example/listings/43" })], hasMore: false },
    ]), repository, { now: () => 1_700_000_003_000, createRunId: () => "run-2" });
    assert.equal(second.updated, 2);
    assert.equal(repository.listings.size, 2);
    assert.equal(repository.listings.get(createExternalListingDocumentId(source.id, "vendor-42"))?.importedAt, 1_700_000_002_000);
});

test("import de-duplicates canonical original URLs when source listing IDs differ", async () => {
    const repository = new MemoryRepository();
    const first = candidate({ sourceListingId: "vendor-42", originalUrl: "https://vendor.example/listings/42" });
    const duplicate = candidate({ sourceListingId: "vendor-copy-42", originalUrl: "https://VENDOR.example:443/listings/42#details" });
    const initial = await runExternalListingImport(adapter([{ items: [first], hasMore: false }]), repository, {
        now: () => 1_700_000_002_000,
        createRunId: () => "url-first",
    });
    assert.equal(initial.created, 1);

    const repeated = await runExternalListingImport(adapter([{ items: [duplicate], hasMore: false }]), repository, {
        now: () => 1_700_000_003_000,
        createRunId: () => "url-duplicate",
    });
    assert.equal(repeated.status, "complete");
    assert.equal(repeated.created, 0);
    assert.equal(repeated.updated, 0);
    assert.equal(repeated.duplicates, 1);
    assert.equal(repository.listings.size, 1);
});

test("partial runs and source failures never stale listings", async () => {
    const repository = new MemoryRepository();
    await repository.upsertListing(normalizeExternalListing(candidate(), source, 1_700_000_000_000));

    const partial = await runExternalListingImport(adapter([
        { items: [candidate({ sourceListingId: "vendor-43" })], hasMore: true, nextCursor: "next" },
    ]), repository, { now: () => 1_700_000_002_000, maxPages: 1, createRunId: () => "partial" });
    assert.equal(partial.status, "partial");
    assert.equal(partial.stale, 0);
    assert.equal(repository.listings.get(createExternalListingDocumentId(source.id, "vendor-42"))?.status, "active");

    const failedAdapter: ExternalListingAdapter = {
        ...adapter([]),
        async fetchPage() { throw new Error("network error"); },
    };
    const failed = await runExternalListingImport(failedAdapter, repository, {
        now: () => 1_700_000_003_000,
        createRunId: () => "failed",
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.errorCode, "source-or-storage-failure");
    assert.equal(failed.stale, 0);

    const failedStorage = new MemoryRepository();
    failedStorage.upsertListing = async () => { throw new Error("write failed"); };
    const writeFailure = await runExternalListingImport(adapter([
        { items: [candidate({ sourceListingId: "new-record" })], hasMore: false },
    ]), failedStorage, { now: () => 1_700_000_004_000, createRunId: () => "write-failure" });
    assert.equal(writeFailure.status, "failed");
    assert.equal(writeFailure.skipped, 0);
    assert.equal(writeFailure.stale, 0);
});

test("successful complete snapshots stale missing records and preserve other sources", async () => {
    const repository = new MemoryRepository();
    const old = normalizeExternalListing(candidate(), source, 1_700_000_000_000);
    const otherSourceListing = normalizeExternalListing(candidate({ sourceListingId: "elsewhere" }), { ...source, id: "other-vendor" }, 1_700_000_000_000);
    await repository.upsertListing(old);
    await repository.upsertListing(otherSourceListing);

    const result = await runExternalListingImport(adapter([
        { items: [], hasMore: false },
    ]), repository, { now: () => 1_700_000_002_000, createRunId: () => "empty-complete" });
    assert.equal(result.stale, 1);
    assert.equal(repository.listings.get(old.id)?.status, "stale");
    assert.equal(repository.listings.get(otherSourceListing.id)?.status, "active");
});

test("delta feeds do not stale records that were not in the page", async () => {
    const repository = new MemoryRepository();
    const old = normalizeExternalListing(candidate(), source, 1_700_000_000_000);
    await repository.upsertListing(old);

    const result = await runExternalListingImport(adapter([
        { items: [], hasMore: false },
    ], false), repository, { now: () => 1_700_000_002_000, createRunId: () => "delta" });
    assert.equal(result.status, "complete");
    assert.equal(result.stale, 0);
    assert.equal(repository.listings.get(old.id)?.status, "active");
});

test("source pages retry a temporary fetch failure with a bounded delay", async () => {
    const repository = new MemoryRepository();
    let attempts = 0;
    const flakyAdapter: ExternalListingAdapter = {
        ...adapter([]),
        async fetchPage() {
            attempts++;
            if (attempts === 1) throw new Error("temporary provider failure");
            return { items: [candidate()], hasMore: false };
        },
    };
    const result = await runExternalListingImport(flakyAdapter, repository, {
        now: () => 1_700_000_002_000,
        createRunId: () => "retry",
        wait: async () => undefined,
    });
    assert.equal(result.status, "complete");
    assert.equal(result.retries, 1);
    assert.equal(attempts, 2);
});

test("a run that loses its source lock after fetching cannot write listings", async () => {
    const repository = new MemoryRepository();
    const ownershipChangingAdapter: ExternalListingAdapter = {
        ...adapter([]),
        async fetchPage() {
            repository.lockRunId = "new-owner";
            repository.lockedUntil = 1_700_000_020_000;
            return { items: [candidate()], hasMore: false };
        },
    };
    const result = await runExternalListingImport(ownershipChangingAdapter, repository, {
        now: () => 1_700_000_002_000,
        createRunId: () => "old-owner",
    });

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "source-or-storage-failure");
    assert.equal(repository.listings.size, 0);
    assert.equal(repository.lockRunId, "new-owner");
});

test("cursor loops and parallel locks are safely rejected", async () => {
    const repository = new MemoryRepository();
    const cursorLoop = await runExternalListingImport(adapter([
        { items: [], hasMore: true, nextCursor: "same" },
        { items: [], hasMore: true, nextCursor: "same" },
    ]), repository, { now: () => 1_700_000_002_000, createRunId: () => "cursor-loop" });
    assert.equal(cursorLoop.status, "failed");
    assert.equal(cursorLoop.stale, 0);

    repository.lockRunId = "another-run";
    repository.lockedUntil = 1_700_000_010_000;
    const skipped = await runExternalListingImport(adapter([]), repository, {
        now: () => 1_700_000_003_000,
        createRunId: () => "parallel",
    });
    assert.equal(skipped.status, "skipped");
    assert.equal(skipped.errorCode, "source-already-running");
});

test("Firestore policy exposes active external records read-only and keeps run stats admin-only", async () => {
    const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    const externalAdMatch = rules.match(/match \/externalAds\/\{externalAdId\} \{([\s\S]*?)\n {4}\}/);
    const importRunMatch = rules.match(/match \/externalImportRuns\/\{runId\} \{([\s\S]*?)\n {4}\}/);
    assert.ok(externalAdMatch);
    assert.match(externalAdMatch[1], /allow get, list: if isAdmin\(\) \|\| resource\.data\.status == 'active';/);
    assert.match(externalAdMatch[1], /allow create, update, delete: if false;/);
    assert.ok(importRunMatch);
    assert.match(importRunMatch[1], /allow get, list: if isAdmin\(\);/);
    assert.match(importRunMatch[1], /allow create, update, delete: if false;/);
});
