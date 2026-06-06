import { createHash } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();
const MAX_IMPORT_LIMIT = 50;
const MAX_HTML_LENGTH = 6_000_000;
const ADMIN_EMAILS = new Set([
    "ozenenesis56@gmail.com",
    "u8075026427@gmail.com",
]);
const DISALLOWED_PATH_PARTS = [
    "/adminpanel/",
    "/api/",
    "/konto/",
    "/mojolx/",
    "/oferta/kontakt/",
    "/i2/",
    "/platnosci/",
    "/d/oferta/",
];

type LeadAudience = "pl" | "ua";
type LeadCategory = "jobs" | "sales" | "services" | "rent" | "other";

type PublicOlxListing = {
    title: string;
    listingUrl: string;
};

export const importOlxLeads = onCall(
    {
        timeoutSeconds: 30,
        maxInstances: 3,
    },
    async (request) => {
        const adminEmail = requireAdminEmail(request.auth);
        const data = (request.data ?? {}) as Record<string, unknown>;
        const audience = requireAudience(data.audience);
        const category = requireCategory(data.category);
        const city = optionalText(data.city, "city", 120);
        const searchUrl = requireMatchingOlxSearchUrl(data.searchUrl, category, city);
        const limit = requireLimit(data.limit);
        const html = await fetchPublicOlxSearchPage(searchUrl);
        const listings = extractPublicOlxListings(html, searchUrl, category).slice(0, limit);

        let imported = 0;
        let duplicates = 0;

        for (const listing of listings) {
            const leadRef = db.collection("leads").doc(createLeadId(listing.listingUrl));

            try {
                await leadRef.create({
                    source: "olx",
                    audience,
                    language: audience,
                    category,
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

                console.error("OLX lead write failed", {
                    adminEmail,
                    listingUrl: listing.listingUrl,
                    error,
                });
                throw new HttpsError("internal", "Nie udało się zapisać leadów.");
            }
        }

        console.log("OLX public lead import completed", {
            adminEmail,
            searchUrl,
            found: listings.length,
            imported,
            duplicates,
        });

        return {
            found: listings.length,
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

function requireOlxSearchUrl(value: unknown): string {
    const raw = requireText(value, "searchUrl", 2000);
    let url: URL;

    try {
        url = new URL(raw);
    } catch {
        throw new HttpsError("invalid-argument", "Podaj prawidłowy adres wyszukiwania OLX.");
    }

    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (hostname !== "olx.pl" && hostname !== "www.olx.pl")) {
        throw new HttpsError("invalid-argument", "Dozwolone są tylko publiczne adresy https://www.olx.pl.");
    }

    const normalizedPath = `${url.pathname.toLowerCase().replace(/\/+$/, "")}/`;
    if (DISALLOWED_PATH_PARTS.some(part => normalizedPath.includes(part))) {
        throw new HttpsError("invalid-argument", "Podaj publiczny adres wyników wyszukiwania, nie stronę konta, API ani ogłoszenia.");
    }

    url.hash = "";
    url.search = "";
    return url.toString();
}

function requireMatchingOlxSearchUrl(
    value: unknown,
    category: LeadCategory,
    city: string
): string {
    const searchUrl = requireOlxSearchUrl(value);
    const expectedUrl = buildOlxSearchUrl(category, city);

    if (searchUrl !== expectedUrl) {
        throw new HttpsError(
            "invalid-argument",
            "Adres wyszukiwania OLX nie odpowiada wybranej kategorii lub miastu."
        );
    }

    return expectedUrl;
}

export function buildOlxSearchUrl(category: LeadCategory, city: string): string {
    const categoryPath: Record<LeadCategory, string> = {
        jobs: "praca",
        sales: "",
        services: "uslugi",
        rent: "nieruchomosci/mieszkania/wynajem",
        other: "",
    };
    const citySlug = toOlxCitySlug(city);
    const pathParts = [categoryPath[category], citySlug].filter(Boolean);
    return `https://www.olx.pl/${pathParts.length > 0 ? `${pathParts.join("/")}/` : ""}`;
}

function toOlxCitySlug(city: string): string {
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

function requireAudience(value: unknown): LeadAudience {
    if (value === "pl" || value === "ua") return value;
    throw new HttpsError("invalid-argument", "Nieprawidłowa grupa odbiorców.");
}

function requireCategory(value: unknown): LeadCategory {
    if (
        value === "jobs" ||
        value === "sales" ||
        value === "services" ||
        value === "rent" ||
        value === "other"
    ) {
        return value;
    }

    throw new HttpsError("invalid-argument", "Nieprawidłowa kategoria leada.");
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

async function fetchPublicOlxSearchPage(searchUrl: string): Promise<string> {
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
                "User-Agent": "XovenLeadImporter/1.0 (+mailto:support@xoven.pl)",
            },
        });

        if (response.status === 403 || response.status === 429) {
            throw new HttpsError(
                "resource-exhausted",
                "OLX odrzucił lub ograniczył żądanie. Import zatrzymano bez ponawiania i bez obchodzenia zabezpieczeń."
            );
        }
        if (!response.ok) {
            throw new HttpsError("failed-precondition", `OLX zwrócił status ${response.status}.`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("text/html")) {
            throw new HttpsError("failed-precondition", "Podany adres nie zwrócił publicznej strony HTML.");
        }

        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_HTML_LENGTH) {
            throw new HttpsError("resource-exhausted", "Strona OLX jest zbyt duża do bezpiecznego importu.");
        }

        const html = await response.text();
        if (html.length > MAX_HTML_LENGTH) {
            throw new HttpsError("resource-exhausted", "Strona OLX jest zbyt duża do bezpiecznego importu.");
        }

        return html;
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
            throw new HttpsError("deadline-exceeded", "OLX nie odpowiedział w wymaganym czasie.");
        }

        console.error("OLX public page request failed", error);
        throw new HttpsError("unavailable", "Nie udało się pobrać publicznej strony OLX.");
    } finally {
        clearTimeout(timeout);
    }
}

export function extractPublicOlxListings(
    html: string,
    searchUrl: string,
    category: LeadCategory
): PublicOlxListing[] {
    const listings = new Map<string, PublicOlxListing>();
    const anchorPattern = /<a\b[^>]*\bhref=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = anchorPattern.exec(html)) !== null) {
        const listingUrl = normalizePublicListingUrl(match[2], searchUrl, category);
        if (!listingUrl) continue;

        const innerHtml = match[3];
        const headingMatch = innerHtml.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i);
        const imageAltMatch = innerHtml.match(/<img\b[^>]*\balt=(["'])(.*?)\1/i);
        const title = normalizeTitle(headingMatch?.[1] ?? imageAltMatch?.[2] ?? "");
        if (!title) continue;

        const existing = listings.get(listingUrl);
        if (!existing || title.length > existing.title.length) {
            listings.set(listingUrl, { title, listingUrl });
        }
    }

    return Array.from(listings.values());
}

function normalizePublicListingUrl(
    href: string,
    searchUrl: string,
    category: LeadCategory
): string | null {
    let url: URL;

    try {
        url = new URL(decodeHtmlEntities(href), searchUrl);
    } catch {
        return null;
    }

    const hostname = url.hostname.toLowerCase();
    if (hostname !== "olx.pl" && hostname !== "www.olx.pl") return null;

    const pathname = url.pathname.toLowerCase();
    const categoryId = pathname.match(/-cid(\d+)-/i)?.[1] ?? "";
    const isJob = pathname.startsWith("/oferta/praca/") && categoryId === "4";
    const isRegularListing = pathname.startsWith("/d/oferta/");

    if (category === "jobs" && !isJob) return null;
    if (category === "services" && (!isRegularListing || categoryId !== "4371")) return null;
    if (category === "rent" && (!isRegularListing || categoryId !== "3")) return null;
    if (
        category === "sales" &&
        (!isRegularListing || categoryId === "3" || categoryId === "4" || categoryId === "4371")
    ) {
        return null;
    }
    if (category === "other" && !isJob && !isRegularListing) return null;

    url.protocol = "https:";
    url.hostname = "www.olx.pl";
    url.search = "";
    url.hash = "";
    return url.toString();
}

function normalizeTitle(value: string): string {
    return decodeHtmlEntities(value)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 250);
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
