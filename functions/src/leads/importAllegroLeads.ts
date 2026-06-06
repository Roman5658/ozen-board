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

type LeadAudience = "pl" | "ua";

type PublicAllegroListing = {
    title: string;
    listingUrl: string;
};

export const importAllegroLeads = onCall(
    {
        timeoutSeconds: 30,
        maxInstances: 3,
    },
    async (request) => {
        const adminEmail = requireAdminEmail(request.auth);
        const data = (request.data ?? {}) as Record<string, unknown>;
        const audience = requireAudience(data.audience);
        const city = optionalText(data.city, "city", 120);
        const searchUrl = requireMatchingAllegroSearchUrl(data.searchUrl, city);
        const limit = requireLimit(data.limit);
        const html = await fetchPublicAllegroSearchPage(searchUrl);
        const listings = extractPublicAllegroListings(html).slice(0, limit);

        let imported = 0;
        let duplicates = 0;

        for (const listing of listings) {
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

    url.search = "";
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
    const baseUrl = "https://allegrolokalnie.pl/oferty/motoryzacja/samochody-149";
    return `${baseUrl}${citySlug ? `/${citySlug}` : "/uzywane"}`;
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
                "Allegro Lokalnie odrzuciło lub ograniczyło żądanie. Import zatrzymano bez ponawiania i bez obchodzenia zabezpieczeń."
            );
        }
        if (!response.ok) {
            throw new HttpsError("failed-precondition", `Allegro Lokalnie zwróciło status ${response.status}.`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("text/html")) {
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

export function extractPublicAllegroListings(html: string): PublicAllegroListing[] {
    const listings = new Map<string, PublicAllegroListing>();
    const articlePattern = /<article\b[^>]*>[\s\S]*?<\/article>/gi;
    let articleMatch: RegExpExecArray | null;

    while ((articleMatch = articlePattern.exec(html)) !== null) {
        const articleHtml = articleMatch[0];
        const linkMatch = articleHtml.match(
            /<a\b[^>]*\bhref=(["'])(\/oferta\/[^"']+)\1[^>]*\bitemprop=(["'])url\3[^>]*>/i
        );
        const titleMatch = articleHtml.match(
            /<h[1-6]\b[^>]*\bitemprop=(["'])itemOffered\1[^>]*>([\s\S]*?)<\/h[1-6]>/i
        );
        if (!linkMatch || !titleMatch) continue;

        const listingUrl = normalizePublicListingUrl(linkMatch[2]);
        const title = normalizeText(titleMatch[2]).slice(0, 250);
        if (!listingUrl || !title) continue;

        listings.set(listingUrl, { title, listingUrl });
    }

    return Array.from(listings.values());
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
