import {
    validateExternalListingSource,
    type ExternalListingCandidate,
    type ExternalListingSource,
} from "./externalListings";
import {
    runExternalListingImport,
    type ExternalListingImportOptions,
    type ExternalListingImportRepository,
    type ExternalListingAdapter,
    type ImportRunResult,
} from "./runExternalListingImport";
import { fetchSafeJsonFeed, validateSafeFeedEndpoint } from "./safeJsonFeed";

export type PartnerJsonFeedConfig = {
    enabled: true;
    endpoint: string;
    allowedFeedHosts: readonly string[];
    source: ExternalListingSource;
    bearerToken?: string;
    providesCompleteSnapshot: boolean;
};

export type PartnerJsonFeedPage = {
    items: readonly unknown[];
    hasMore: boolean;
    nextCursor?: string;
};

type JsonObject = Record<string, unknown>;
type SafeJsonFetcher = typeof fetchSafeJsonFeed;

function containsControlCharacters(value: string): boolean {
    return Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
    });
}

function settingCode(value: string): string {
    return value.toLowerCase().replace(/_/g, "-");
}

function asObject(value: unknown): JsonObject | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as JsonObject
        : null;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name]?.trim();
    if (!value) throw new Error(`missing-${settingCode(name)}`);
    return value;
}

function parseList(value: string, setting: string): string[] {
    const values = value.split(",").map((item) => item.trim()).filter(Boolean);
    if (!values.length) throw new Error(`missing-${settingCode(setting)}`);
    return values;
}

function parseCategoryMappings(value: string): ExternalListingSource["categoryMappings"] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error("invalid-external-listings-category-mappings");
    }
    const mappings = asObject(parsed);
    if (!mappings) throw new Error("invalid-external-listings-category-mappings");
    return mappings as ExternalListingSource["categoryMappings"];
}

export function isExternalListingsEnabled(value: string | undefined = process.env.EXTERNAL_LISTINGS_ENABLED): boolean {
    return value === "true";
}

export function loadPartnerJsonFeedConfig(env: NodeJS.ProcessEnv = process.env): PartnerJsonFeedConfig | null {
    if (!isExternalListingsEnabled(env.EXTERNAL_LISTINGS_ENABLED)) return null;

    const endpoint = required(env, "EXTERNAL_LISTINGS_FEED_URL");
    const allowedFeedHosts = parseList(required(env, "EXTERNAL_LISTINGS_FEED_HOSTS"), "EXTERNAL_LISTINGS_FEED_HOSTS");
    validateSafeFeedEndpoint(endpoint, allowedFeedHosts);

    const reviewedAt = Number(required(env, "EXTERNAL_LISTINGS_RIGHTS_REVIEWED_AT"));
    if (!Number.isFinite(reviewedAt) || reviewedAt <= 0) throw new Error("invalid-external-listings-rights-reviewed-at");
    const rightsFields = parseList(required(env, "EXTERNAL_LISTINGS_RIGHTS_FIELDS"), "EXTERNAL_LISTINGS_RIGHTS_FIELDS");
    const permissionConfirmed = env.EXTERNAL_LISTINGS_PERMISSION_CONFIRMED === "true";
    const source: ExternalListingSource = {
        id: required(env, "EXTERNAL_LISTINGS_SOURCE_ID").toLowerCase(),
        displayName: required(env, "EXTERNAL_LISTINGS_SOURCE_NAME"),
        allowedListingHosts: parseList(required(env, "EXTERNAL_LISTINGS_LISTING_HOSTS"), "EXTERNAL_LISTINGS_LISTING_HOSTS"),
        allowedImageHosts: (env.EXTERNAL_LISTINGS_IMAGE_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean),
        rights: {
            reference: required(env, "EXTERNAL_LISTINGS_RIGHTS_REFERENCE"),
            reviewedAt,
            permissionConfirmed,
            fields: rightsFields as ExternalListingSource["rights"]["fields"],
        },
        categoryMappings: parseCategoryMappings(required(env, "EXTERNAL_LISTINGS_CATEGORY_MAPPINGS_JSON")),
    };
    validateExternalListingSource(source);

    return {
        enabled: true,
        endpoint,
        allowedFeedHosts,
        source,
        ...(env.EXTERNAL_LISTINGS_FEED_TOKEN ? { bearerToken: env.EXTERNAL_LISTINGS_FEED_TOKEN } : {}),
        providesCompleteSnapshot: env.EXTERNAL_LISTINGS_COMPLETE_SNAPSHOT === "true",
    };
}

export function mapPartnerJsonFeedPage(value: unknown): PartnerJsonFeedPage {
    const page = asObject(value);
    if (!page || !Array.isArray(page.items) || typeof page.hasMore !== "boolean") {
        throw new Error("invalid-partner-feed-page");
    }
    if (page.hasMore && (typeof page.nextCursor !== "string" || !page.nextCursor.trim() ||
        page.nextCursor.length > 512 || containsControlCharacters(page.nextCursor))) {
        throw new Error("invalid-partner-feed-cursor");
    }
    if (page.nextCursor !== undefined && typeof page.nextCursor !== "string") {
        throw new Error("invalid-partner-feed-cursor");
    }
    return {
        items: page.items,
        hasMore: page.hasMore,
        ...(typeof page.nextCursor === "string" ? { nextCursor: page.nextCursor } : {}),
    };
}

export function mapPartnerJsonFeedCandidate(value: unknown): ExternalListingCandidate {
    const item = asObject(value);
    if (!item) throw new Error("invalid-partner-feed-item");
    return {
        sourceListingId: item.sourceListingId,
        originalUrl: item.originalUrl,
        title: item.title,
        ...(item.description !== undefined ? { description: item.description } : {}),
        ...(item.sourceCategory !== undefined ? { sourceCategory: item.sourceCategory } : {}),
        ...(item.offerType !== undefined ? { offerType: item.offerType } : {}),
        ...(item.priceAmount !== undefined ? { priceAmount: item.priceAmount } : {}),
        ...(item.currency !== undefined ? { currency: item.currency } : {}),
        ...(item.city !== undefined ? { city: item.city } : {}),
        ...(item.voivodeship !== undefined ? { voivodeship: item.voivodeship } : {}),
        ...(item.location !== undefined ? { location: item.location as ExternalListingCandidate["location"] } : {}),
        ...(item.images !== undefined ? { images: item.images } : {}),
        ...(item.sourcePublishedAt !== undefined ? { sourcePublishedAt: item.sourcePublishedAt } : {}),
        ...(item.sourceStatus !== undefined ? { sourceStatus: item.sourceStatus } : {}),
    };
}

export function createPartnerJsonFeedAdapter(
    config: PartnerJsonFeedConfig,
    fetchJsonFeed: SafeJsonFetcher = fetchSafeJsonFeed,
): ExternalListingAdapter {
    if (!config.enabled) throw new Error("external-listings-disabled");
    validateExternalListingSource(config.source);
    validateSafeFeedEndpoint(config.endpoint, config.allowedFeedHosts);

    return {
        source: config.source,
        providesCompleteSnapshot: config.providesCompleteSnapshot,
        async fetchPage(cursor, pageSize, signal) {
            const endpoint = new URL(config.endpoint);
            endpoint.searchParams.set("limit", String(pageSize));
            if (cursor !== undefined) endpoint.searchParams.set("cursor", cursor);
            else endpoint.searchParams.delete("cursor");
            const value = await fetchJsonFeed(endpoint.toString(), config.allowedFeedHosts, signal, {
                ...(config.bearerToken ? { bearerToken: config.bearerToken } : {}),
            });
            return mapPartnerJsonFeedPage(value);
        },
        mapCandidate: mapPartnerJsonFeedCandidate,
    };
}

/** Run a configured partner feed with a hard cap of 20 source rows per invocation. */
export async function runPartnerJsonFeedImport(
    config: PartnerJsonFeedConfig | null,
    repository: ExternalListingImportRepository,
    options: ExternalListingImportOptions = {},
    fetchJsonFeed: SafeJsonFetcher = fetchSafeJsonFeed,
): Promise<ImportRunResult | null> {
    if (!config || !isExternalListingsEnabled(process.env.EXTERNAL_LISTINGS_ENABLED)) return null;
    const maxRecords = Math.min(Math.max(Math.floor(options.maxRecords ?? 20), 1), 20);
    const pageSize = Math.min(Math.max(Math.floor(options.pageSize ?? maxRecords), 1), maxRecords);
    return runExternalListingImport(createPartnerJsonFeedAdapter(config, fetchJsonFeed), repository, {
        ...options,
        maxPages: 1,
        maxRecords,
        pageSize,
    });
}
