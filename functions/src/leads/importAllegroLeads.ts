import { createHash } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();
const MAX_IMPORT_LIMIT = 50;
const MAX_HTML_LENGTH = 6_000_000;
const MAX_CACHE_ENTRIES = 20;
const PAGE_CACHE_TTL_MS = 5 * 60_000;
const MIN_NETWORK_INTERVAL_MS = 30_000;
const RATE_LIMIT_COOLDOWN_MS = 15 * 60_000;
const ADMIN_EMAILS = new Set([
    "ozenenesis56@gmail.com",
    "u8075026427@gmail.com",
]);
const pageCache = new Map<string, { html: string; expiresAt: number }>();
let nextNetworkRequestAt = 0;
let rateLimitedUntil = 0;

type LeadAudience = "pl" | "ua";

type PublicAllegroListing = {
    title: string;
    listingUrl: string;
};

export const importAllegroLeads = onCall(
    {
        timeoutSeconds: 30,
        maxInstances: 1,
        concurrency: 1,
    },
    async (request) => {
        const adminEmail = requireAdminEmail(request.auth);
        const data = (request.data ?? {}) as Record<string, unknown>;
        const audience = requireAudience(data.audience);
        const city = optionalText(data.city, "city", 120);
        const searchUrl = requireMatchingAllegroSearchUrl(data.searchUrl, city);
        const limit = requireLimit(data.limit);
        const html = await fetchPublicAllegroSearchPage(searchUrl);
        const parsedListings = extractPublicAllegroListings(html);

        if (parsedListings.length === 0) {
            const reason = hasPublicAllegroOfferLinks(html)
                ? "page_structure_changed"
                : "no_public_cards";

            console.warn("Allegro Lokalnie public lead import rejected", {
                adminEmail,
                searchUrl,
                reason,
                found: 0,
                imported: 0,
                duplicates: 0,
            });

            throw new HttpsError(
                "failed-precondition",
                reason === "page_structure_changed"
                    ? "Struktura publicznej strony Allegro Lokalnie uległa zmianie."
                    : "Allegro Lokalnie nie zwróciło publicznych kart ogłoszeń."
            );
        }

        let imported = 0;
        let duplicates = 0;
        let processed = 0;

        for (const listing of parsedListings) {
            if (imported >= limit) break;
            processed++;

            const leadRef = db.collection("leads").doc(createLeadId(listing.listingUrl));

            try {
                await leadRef.create({
                    source: "allegro_lokalnie",
                    audience,
                    language: audience,
                    category: "sales",
                    city,
                    title: listing.title,
                    listingUrl: listing.listingUrl,
                    contactUrl: listing.listingUrl,
                    status: "new",
                    note: "",
                    createdAt: Date.now(),
                });
                imported++;
            } catch (error) {
                if (isAlreadyExistsError(error)) {
                    duplicates++;
                    continue;
                }

                console.error("Allegro Lokalnie lead write failed", {
                    adminEmail,
                    listingUrl: listing.listingUrl,
                    error,
                });
                throw new HttpsError("internal", "Nie udało się zapisać leadów Allegro Lokalnie.");
            }
        }

        console.log("Allegro Lokalnie public lead import completed", {
            adminEmail,
            searchUrl,
            found: parsedListings.length,
            processed,
            imported,
            duplicates,
        });

        return {
            found: parsedListings.length,
            imported,
            duplicates,
        };
    }
);

function requireAdminEmail(auth: { token: Record<string, unknown> } | undefined): string {
    const email = typeof auth?.token.email === "string"
        ? auth.token.email.trim().toLowerCase()
        : "";

    if (!email) {
        throw new HttpsError("unauthenticated", "Zaloguj się jako administrator.");
    }
    if (!ADMIN_EMAILS.has(email)) {
        throw new HttpsError("permission-denied", "Brak uprawnień administratora.");
    }
    return email;
}

function requireAudience(value: unknown): LeadAudience {
    if (value === "pl" || value === "ua") return value;
    throw new HttpsError("invalid-argument", "Nieprawidłowa grupa odbiorców.");
}

function requireMatchingAllegroSearchUrl(value: unknown, city: string): string {
    const raw = requireText(value, "searchUrl", 2000);
    let url: URL;

    try {
        url = new URL(raw);
    } catch {
        throw new HttpsError("invalid-argument", "Podaj prawidłowy publiczny adres wyszukiwania Allegro Lokalnie.");
    }

    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || hostname !== "allegrolokalnie.pl") {
        throw new HttpsError("invalid-argument", "Dozwolone są tylko publiczne adresy https://allegrolokalnie.pl.");
    }
    if (url.username || url.password || url.port) {
        throw new HttpsError("invalid-argument", "Podaj zwykły publiczny adres Allegro Lokalnie.");
    }

    url.hash = "";

    const expectedUrl = buildAllegroSearchUrl(city);
    if (url.toString() !== expectedUrl) {
        throw new HttpsError(
            "invalid-argument",
            "Adres wyszukiwania Allegro Lokalnie nie odpowiada wybranemu miastu."
        );
    }
    return expectedUrl;
}

export function buildAllegroSearchUrl(city: string): string {
    const citySlug = toCitySlug(city);
    const url = new URL(
        citySlug
            ? `https://allegrolokalnie.pl/oferty/${citySlug}`
            : "https://allegrolokalnie.pl/oferty/q/u%C5%BCywane"
    );
    url.searchParams.set("zrodlo", "lokalnie");
    return url.toString();
}

function toCitySlug(city: string): string {
    if (!city.trim()) return "";

    const slug = city
        .trim()
        .toLowerCase()
        .replace(/ł/g, "l")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    if (!slug) {
        throw new HttpsError("invalid-argument", "Nieprawidłowa nazwa miasta.");
    }
    return slug;
}

function requireText(value: unknown, field: string, maxLength: number): string {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || text.length > maxLength) {
        throw new HttpsError("invalid-argument", `Nieprawidłowe pole ${field}.`);
    }
    return text;
}

function optionalText(value: unknown, field: string, maxLength: number): string {
    const text = typeof value === "string" ? value.trim() : "";
    if (text.length > maxLength) {
        throw new HttpsError("invalid-argument", `Nieprawidłowe pole ${field}.`);
    }
    return text;
}

function requireLimit(value: unknown): number {
    const limit = typeof value === "number" ? Math.floor(value) : Number(value);
    if (!Number.isFinite(limit) || limit < 1 || limit > MAX_IMPORT_LIMIT) {
        throw new HttpsError("invalid-argument", `Limit musi wynosić od 1 do ${MAX_IMPORT_LIMIT}.`);
    }
    return limit;
}

async function fetchPublicAllegroSearchPage(searchUrl: string): Promise<string> {
    const now = Date.now();
    const cachedPage = pageCache.get(searchUrl);

    if (cachedPage && cachedPage.expiresAt > now) {
        console.log("Allegro Lokalnie public page cache hit", { searchUrl });
        return cachedPage.html;
    }
    if (cachedPage) {
        pageCache.delete(searchUrl);
    }

    if (now < rateLimitedUntil) {
        console.warn("Allegro Lokalnie public page request skipped", {
            searchUrl,
            reason: "429_cooldown",
            retryAfterMs: rateLimitedUntil - now,
            found: 0,
            imported: 0,
            duplicates: 0,
        });
        throw new HttpsError(
            "resource-exhausted",
            "Allegro Lokalnie wcześniej zwróciło 429. Automatyczne próby są wstrzymane; użyj ręcznego dodawania leada."
        );
    }

    if (now < nextNetworkRequestAt) {
        console.warn("Allegro Lokalnie public page request skipped", {
            searchUrl,
            reason: "local_request_interval",
            retryAfterMs: nextNetworkRequestAt - now,
            found: 0,
            imported: 0,
            duplicates: 0,
        });
        throw new HttpsError(
            "resource-exhausted",
            "Odczekaj chwilę przed kolejnym importem Allegro Lokalnie."
        );
    }

    nextNetworkRequestAt = now + MIN_NETWORK_INTERVAL_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
        const response = await fetch(searchUrl, {
            method: "GET",
            redirect: "error",
            signal: controller.signal,
            headers: {
                Accept: "text/html,application/xhtml+xml",
                "Accept-Language": "pl-PL,pl;q=0.9",
                "User-Agent": "Mozilla/5.0 (compatible; XovenLeadImporter/1.0; +mailto:support@xoven.pl)",
            },
        });

        if (response.status === 403 || response.status === 429) {
            if (response.status === 429) {
                rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
            }
            console.warn("Allegro Lokalnie public page request rejected", {
                searchUrl,
                reason: String(response.status),
                status: response.status,
                found: 0,
                imported: 0,
                duplicates: 0,
            });
            throw new HttpsError(
                "resource-exhausted",
                response.status === 429
                    ? "Allegro Lokalnie zwróciło 429. Import zatrzymano bez ponawiania; użyj ręcznego dodawania leada."
                    : "Allegro Lokalnie odrzuciło publiczne żądanie Cloud Function (403). Automatyczny import jest niedostępny; użyj ręcznego dodawania leada."
            );
        }
        if (!response.ok) {
            console.warn("Allegro Lokalnie public page request failed", {
                searchUrl,
                reason: `http_${response.status}`,
                status: response.status,
                found: 0,
                imported: 0,
                duplicates: 0,
            });
            throw new HttpsError("failed-precondition", `Allegro Lokalnie zwróciło status ${response.status}.`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("text/html")) {
            console.warn("Allegro Lokalnie public page request failed", {
                searchUrl,
                reason: "page_structure_changed",
                contentType,
                found: 0,
                imported: 0,
                duplicates: 0,
            });
            throw new HttpsError("failed-precondition", "Podany adres nie zwrócił publicznej strony HTML Allegro Lokalnie.");
        }

        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_HTML_LENGTH) {
            throw new HttpsError("resource-exhausted", "Strona Allegro Lokalnie jest zbyt duża do bezpiecznego importu.");
        }

        const html = await response.text();
        if (html.length > MAX_HTML_LENGTH) {
            throw new HttpsError("resource-exhausted", "Strona Allegro Lokalnie jest zbyt duża do bezpiecznego importu.");
        }

        prunePageCache();
        pageCache.set(searchUrl, {
            html,
            expiresAt: Date.now() + PAGE_CACHE_TTL_MS,
        });
        return html;
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
            throw new HttpsError("deadline-exceeded", "Allegro Lokalnie nie odpowiedziało w wymaganym czasie.");
        }

        console.error("Allegro Lokalnie public page request failed", error);
        throw new HttpsError("unavailable", "Nie udało się pobrać publicznej strony Allegro Lokalnie.");
    } finally {
        clearTimeout(timeout);
    }
}

function prunePageCache(): void {
    const now = Date.now();

    for (const [url, cachedPage] of pageCache) {
        if (cachedPage.expiresAt <= now) {
            pageCache.delete(url);
        }
    }

    while (pageCache.size >= MAX_CACHE_ENTRIES) {
        const oldestUrl = pageCache.keys().next().value as string | undefined;
        if (!oldestUrl) break;
        pageCache.delete(oldestUrl);
    }
}

export function extractPublicAllegroListings(html: string): PublicAllegroListing[] {
    const listings = new Map<string, PublicAllegroListing>();
    const articlePattern = /<article\b[^>]*>[\s\S]*?<\/article>/gi;
    let articleMatch: RegExpExecArray | null;

    while ((articleMatch = articlePattern.exec(html)) !== null) {
        const articleHtml = articleMatch[0];
        const linkMatch = findPublicOfferHref(articleHtml);
        const titleMatch = articleHtml.match(
            /<h[1-6]\b[^>]*\bitemprop=(["'])itemOffered\1[^>]*>([\s\S]*?)<\/h[1-6]>/i
        );
        if (!linkMatch || !titleMatch) continue;

        const listingUrl = normalizePublicListingUrl(linkMatch);
        const title = normalizeText(titleMatch[2]).slice(0, 250);
        if (!listingUrl || !title) continue;

        listings.set(listingUrl, { title, listingUrl });
    }

    return Array.from(listings.values());
}

function findPublicOfferHref(articleHtml: string): string | null {
    const anchorPattern = /<a\b([^>]*)>/gi;
    let anchorMatch: RegExpExecArray | null;

    while ((anchorMatch = anchorPattern.exec(articleHtml)) !== null) {
        const attributes = anchorMatch[1];
        if (!/\bitemprop=(["'])url\1/i.test(attributes)) continue;

        const hrefMatch = attributes.match(/\bhref=(["'])([^"']+)\1/i);
        if (hrefMatch) return hrefMatch[2];
    }

    return null;
}

function hasPublicAllegroOfferLinks(html: string): boolean {
    return /href=(["'])(?:https:\/\/allegrolokalnie\.pl)?\/oferta\/[^"']+\1/i.test(html);
}

function normalizePublicListingUrl(href: string): string | null {
    let url: URL;
    try {
        url = new URL(decodeHtmlEntities(href), "https://allegrolokalnie.pl");
    } catch {
        return null;
    }

    if (url.hostname.toLowerCase() !== "allegrolokalnie.pl") return null;
    if (!/^\/oferta\/[^/]+$/i.test(url.pathname)) return null;

    url.protocol = "https:";
    url.search = "";
    url.hash = "";
    return url.toString();
}

function normalizeText(value: string): string {
    return decodeHtmlEntities(value)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function decodeHtmlEntities(value: string): string {
    const namedEntities: Record<string, string> = {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        nbsp: " ",
        quot: "\"",
    };

    return value
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
        .replace(/&([a-z]+);/gi, (entity, name: string) => namedEntities[name.toLowerCase()] ?? entity);
}

function createLeadId(listingUrl: string): string {
    return createHash("sha256").update(listingUrl).digest("hex");
}

function isAlreadyExistsError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const maybeError = error as { code?: number | string };
    return maybeError.code === 6 || maybeError.code === "already-exists";
}
