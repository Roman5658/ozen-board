import { createHash } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();
const ADMIN_EMAILS = new Set([
    "ozenenesis56@gmail.com",
    "u8075026427@gmail.com",
]);

type LeadAudience = "pl" | "ua";
type LeadSource = "olx" | "otomoto" | "allegro_lokalnie" | "manual" | "other";
type LeadCategory = "jobs" | "sales" | "services" | "rent" | "other";

export const createManualLead = onCall(
    {
        timeoutSeconds: 15,
        maxInstances: 3,
    },
    async (request) => {
        const adminEmail = requireAdminEmail(request.auth);
        const data = (request.data ?? {}) as Record<string, unknown>;
        const source = requireSource(data.source);
        const audience = requireAudience(data.audience);
        const language = requireAudience(data.language);
        const category = requireCategory(data.category);
        const city = optionalText(data.city, "city", 120);
        const title = requireText(data.title, "title", 250);
        const listingUrl = requirePublicUrl(data.listingUrl, "listingUrl");
        const contactUrl = optionalPublicUrl(data.contactUrl, "contactUrl") ?? listingUrl;
        const note = optionalText(data.note, "note", 2000);
        const leadId = createLeadId(listingUrl);

        try {
            await db.collection("leads").doc(leadId).create({
                source,
                audience,
                language,
                category,
                city,
                title,
                listingUrl,
                contactUrl,
                status: "new",
                note,
                createdAt: Date.now(),
            });
        } catch (error) {
            if (isAlreadyExistsError(error)) {
                return { created: false, duplicate: true, leadId };
            }

            console.error("Manual lead write failed", {
                adminEmail,
                listingUrl,
                error,
            });
            throw new HttpsError("internal", "Nie udało się zapisać leada.");
        }

        console.log("Manual lead created", {
            adminEmail,
            source,
            listingUrl,
            leadId,
        });

        return { created: true, duplicate: false, leadId };
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

function requireSource(value: unknown): LeadSource {
    if (
        value === "olx" ||
        value === "otomoto" ||
        value === "allegro_lokalnie" ||
        value === "manual" ||
        value === "other"
    ) {
        return value;
    }
    throw new HttpsError("invalid-argument", "Nieprawidłowe źródło leada.");
}

function requireAudience(value: unknown): LeadAudience {
    if (value === "pl" || value === "ua") return value;
    throw new HttpsError("invalid-argument", "Nieprawidłowy język lub grupa odbiorców.");
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

function requirePublicUrl(value: unknown, field: string): string {
    const raw = requireText(value, field, 2000);
    return normalizePublicUrl(raw, field);
}

function optionalPublicUrl(value: unknown, field: string): string | null {
    const raw = optionalText(value, field, 2000);
    return raw ? normalizePublicUrl(raw, field) : null;
}

function normalizePublicUrl(raw: string, field: string): string {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new HttpsError("invalid-argument", `Nieprawidłowy adres ${field}.`);
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new HttpsError("invalid-argument", `Nieprawidłowy adres ${field}.`);
    }

    url.hash = "";
    return url.toString();
}

function createLeadId(listingUrl: string): string {
    return createHash("sha256").update(listingUrl).digest("hex");
}

function isAlreadyExistsError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const maybeError = error as { code?: number | string };
    return maybeError.code === 6 || maybeError.code === "already-exists";
}
