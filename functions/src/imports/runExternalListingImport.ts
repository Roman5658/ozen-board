import { randomUUID } from "node:crypto";
import {
    ExternalListingValidationError,
    normalizeExternalListing,
    validateExternalListingSource,
    type ExternalListing,
    type ExternalListingCandidate,
    type ExternalListingSource,
} from "./externalListings";

export type ExternalListingPage = {
    items: readonly unknown[];
    hasMore: boolean;
    nextCursor?: string;
};

export type ExternalListingAdapter = {
    source: ExternalListingSource;
    /** True only when a complete successful run represents the whole current source inventory. */
    providesCompleteSnapshot: boolean;
    fetchPage(cursor: string | undefined, pageSize: number, signal: AbortSignal): Promise<ExternalListingPage>;
    mapCandidate(value: unknown): ExternalListingCandidate;
};

export type ImportRunStatus = "complete" | "partial" | "failed" | "skipped";

export type ImportRunResult = {
    runId: string;
    sourceId: string;
    status: ImportRunStatus;
    startedAt: number;
    completedAt: number;
    pages: number;
    received: number;
    created: number;
    updated: number;
    skipped: number;
    duplicates: number;
    stale: number;
    staleScanLimited: boolean;
    retries: number;
    errorCode?: string;
};

export type ExternalListingImportRepository = {
    acquireLock(sourceId: string, runId: string, now: number, lockMs: number): Promise<boolean>;
    renewLock(sourceId: string, runId: string, now: number, lockMs: number): Promise<boolean>;
    startRun(runId: string, sourceId: string, startedAt: number): Promise<void>;
    upsertListing(listing: ExternalListing, runId: string, now: number): Promise<"created" | "updated" | "duplicate" | "limited">;
    markMissingAsStale(sourceId: string, seenAt: number, maxRecords: number, runId: string, now: number): Promise<{ marked: number; scanLimited: boolean }>;
    finishRun(result: ImportRunResult): Promise<void>;
    releaseLock(sourceId: string, runId: string): Promise<void>;
};

export type ExternalListingImportOptions = {
    now?: () => number;
    createRunId?: () => string;
    maxPages?: number;
    maxRecords?: number;
    pageSize?: number;
    fetchTimeoutMs?: number;
    maxFetchRetries?: number;
    wait?: (milliseconds: number) => Promise<void>;
    /** Optional diagnostics hook. Exceptions in observers must never affect the import result. */
    onRecordSkipped?: (error: unknown) => void;
};

const LOCK_MS = 15 * 60 * 1000;
const DEFAULT_MAX_PAGES = 10;
const HARD_MAX_PAGES = 20;
const DEFAULT_MAX_RECORDS = 500;
const HARD_MAX_RECORDS = 1_000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_TIMEOUT_MS = 30_000;
const MAX_FETCH_RETRIES = 2;

function clampInteger(value: number | undefined, fallback: number, max: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.floor(value as number), 1), max);
}

function validationCode(error: unknown): string {
    return error instanceof ExternalListingValidationError ? error.code : "invalid-record";
}

async function fetchPageWithRetries(
    adapter: ExternalListingAdapter,
    cursor: string | undefined,
    pageSize: number,
    timeoutMs: number,
    maxRetries: number,
    wait: (milliseconds: number) => Promise<void>,
    onRetry: () => void,
): Promise<ExternalListingPage> {
    for (let attempt = 0; ; attempt++) {
        const controller = new AbortController();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    controller.abort();
                    reject(new Error("source-timeout"));
                }, timeoutMs);
            });
            const page = await Promise.race([
                adapter.fetchPage(cursor, pageSize, controller.signal),
                timeoutPromise,
            ]);
            return page;
        } catch (error) {
            if (attempt >= maxRetries) throw error;
            onRetry();
            await wait(250 * (2 ** attempt));
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }
}

export async function runExternalListingImport(
    adapter: ExternalListingAdapter,
    repository: ExternalListingImportRepository,
    options: ExternalListingImportOptions = {},
): Promise<ImportRunResult> {
    const now = options.now ?? Date.now;
    const startedAt = now();
    const createRunId = options.createRunId ?? randomUUID;
    const runId = createRunId();
    const maxPages = clampInteger(options.maxPages, DEFAULT_MAX_PAGES, HARD_MAX_PAGES);
    const maxRecords = clampInteger(options.maxRecords, DEFAULT_MAX_RECORDS, HARD_MAX_RECORDS);
    const pageSize = clampInteger(options.pageSize, DEFAULT_PAGE_SIZE, Math.min(maxRecords, 250));
    const fetchTimeoutMs = clampInteger(options.fetchTimeoutMs, DEFAULT_FETCH_TIMEOUT_MS, MAX_FETCH_TIMEOUT_MS);
    const requestedRetries = options.maxFetchRetries;
    const maxFetchRetries = Number.isFinite(requestedRetries)
        ? Math.min(Math.max(Math.floor(requestedRetries as number), 0), MAX_FETCH_RETRIES)
        : MAX_FETCH_RETRIES;
    const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const result: ImportRunResult = {
        runId,
        sourceId: adapter.source.id,
        status: "failed",
        startedAt,
        completedAt: startedAt,
        pages: 0,
        received: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        duplicates: 0,
        stale: 0,
        staleScanLimited: false,
        retries: 0,
    };

    try {
        validateExternalListingSource(adapter.source);
    } catch (error) {
        result.status = "failed";
        result.errorCode = validationCode(error);
        result.completedAt = now();
        await repository.finishRun(result);
        return result;
    }

    const acquired = await repository.acquireLock(adapter.source.id, runId, startedAt, LOCK_MS);
    if (!acquired) {
        result.status = "skipped";
        result.errorCode = "source-already-running";
        result.completedAt = now();
        await repository.finishRun(result);
        return result;
    }

    const seenListingIds = new Set<string>();
    const seenListingUrls = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let sourceCompleted = false;
    let limitReached = false;

    try {
        await repository.startRun(runId, adapter.source.id, startedAt);
        while (result.pages < maxPages && result.received < maxRecords) {
            if (!await repository.renewLock(adapter.source.id, runId, now(), LOCK_MS)) {
                throw new Error("source-lock-lost");
            }
            const fetched = await fetchPageWithRetries(
                adapter,
                cursor,
                Math.min(pageSize, maxRecords - result.received),
                fetchTimeoutMs,
                maxFetchRetries,
                wait,
                () => { result.retries++; },
            );
            const page = fetched;
            if (!await repository.renewLock(adapter.source.id, runId, now(), LOCK_MS)) {
                throw new Error("source-lock-lost");
            }
            if (!page || !Array.isArray(page.items) || typeof page.hasMore !== "boolean") {
                throw new Error("invalid-source-page");
            }
            result.pages++;
            const remaining = maxRecords - result.received;
            const items = page.items.slice(0, remaining);
            if (page.items.length > remaining) limitReached = true;
            result.received += items.length;

            for (const raw of items) {
                let listing: ExternalListing;
                try {
                    const candidate = adapter.mapCandidate(raw);
                    listing = normalizeExternalListing(candidate, adapter.source, now());
                } catch (error) {
                    result.skipped++;
                    try {
                        options.onRecordSkipped?.(error);
                    } catch {
                        // Diagnostics must not change import behavior.
                    }
                    continue;
                }
                if (seenListingIds.has(listing.sourceListingId)) {
                    result.duplicates++;
                    continue;
                }
                seenListingIds.add(listing.sourceListingId);
                if (seenListingUrls.has(listing.normalizedUrlHash)) {
                    result.duplicates++;
                    continue;
                }
                seenListingUrls.add(listing.normalizedUrlHash);
                const writeResult = await repository.upsertListing(listing, runId, now());
                if (writeResult === "duplicate") {
                    result.duplicates++;
                    continue;
                }
                if (writeResult === "limited") {
                    result.skipped++;
                    result.errorCode = "daily-creation-limit-reached";
                    limitReached = true;
                    break;
                }
                if (writeResult === "created") result.created++;
                else result.updated++;
                if ((result.created + result.updated) % 100 === 0 &&
                    !await repository.renewLock(adapter.source.id, runId, now(), LOCK_MS)) {
                    throw new Error("source-lock-lost");
                }
            }

            if (!page.hasMore) {
                sourceCompleted = true;
                break;
            }
            if (typeof page.nextCursor !== "string" || !page.nextCursor || seenCursors.has(page.nextCursor)) {
                throw new Error("invalid-source-cursor");
            }
            seenCursors.add(page.nextCursor);
            cursor = page.nextCursor;
        }

        if (limitReached || (!sourceCompleted && (result.pages >= maxPages || result.received >= maxRecords))) {
            result.status = "partial";
        } else if (!sourceCompleted) {
            throw new Error("incomplete-source-run");
        } else {
            result.status = "complete";
        }

        // Only a declared, complete inventory can make unseen records stale.
        // Delta feeds and truncated runs never hide data.
        if (result.status === "complete" && adapter.providesCompleteSnapshot) {
            if (!await repository.renewLock(adapter.source.id, runId, now(), LOCK_MS)) {
                throw new Error("source-lock-lost");
            }
            const stale = await repository.markMissingAsStale(adapter.source.id, startedAt, maxRecords, runId, now());
            result.stale = stale.marked;
            result.staleScanLimited = stale.scanLimited;
        }
    } catch {
        result.status = "failed";
        result.errorCode = "source-or-storage-failure";
        result.stale = 0;
        result.staleScanLimited = false;
    } finally {
        result.completedAt = now();
        try {
            await repository.finishRun(result);
        } finally {
            await repository.releaseLock(adapter.source.id, runId);
        }
    }

    return result;
}
