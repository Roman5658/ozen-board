import { createHash } from "node:crypto";
import {
    validateExternalListingSource,
    type ExternalListingCandidate,
    type ExternalListingField,
    type ExternalListingCategory,
    type ExternalListingSource,
} from "./externalListings";
import type { ExternalListingAdapter, ExternalListingPage } from "./runExternalListingImport";

type JsonObject = Record<string, unknown>;
export type TelegramChatType = "group" | "supergroup" | "channel";

export type TelegramChatSource = {
    chatId: string;
    publicUsername: string;
    chatType?: TelegramChatType;
    /** When configured, only these Telegram user IDs may submit messages; an empty set denies all senders. */
    allowedSenderIds?: ReadonlySet<string>;
    autoPublish: boolean;
    maxUpdatesPerMinute: number;
    source: ExternalListingSource;
};

export type TelegramListingsConfig = {
    enabled: true;
    chats: ReadonlyMap<string, TelegramChatSource>;
};

export type TelegramChatSourceLookup =
    | { found: true; source: TelegramChatSource }
    | { found: false; reason: "chat_id_missing_or_invalid" | "chat_id_not_allowlisted" };

/** Resolves an already parsed update chat ID without exposing it in diagnostic output. */
export function lookupTelegramChatSource(
    chatId: string | undefined,
    chats: ReadonlyMap<string, TelegramChatSource>,
): TelegramChatSourceLookup {
    if (chatId === undefined) return { found: false, reason: "chat_id_missing_or_invalid" };
    const source = chats.get(chatId);
    return source ? { found: true, source } : { found: false, reason: "chat_id_not_allowlisted" };
}

export type TelegramListingSkipReason =
    | "source_not_allowed"
    | "chat_type_mismatch"
    | "sender_not_allowed"
    | "forwarded_or_automated"
    | "empty_text"
    | "empty_title"
    | "invalid_title"
    | "empty_description"
    | "description_too_short"
    | "invalid_price"
    | "missing_price"
    | "invalid_offer_type"
    | "conflicting_offer_price"
    | "message_too_long"
    | "invalid_source_configuration"
    | "validation_failed";

/** Maps internal validation errors to a fixed, safe log value; never return raw message content. */
export function getTelegramListingSkipReason(error: unknown): TelegramListingSkipReason {
    const code = error instanceof Error ? error.message : "";
    switch (code) {
        case "unapproved-telegram-chat":
        case "telegram-public-link-unavailable":
            return "source_not_allowed";
        case "telegram-chat-type-mismatch":
            return "chat_type_mismatch";
        case "unapproved-telegram-sender":
            return "sender_not_allowed";
        case "forwarded-or-automated-telegram-message":
            return "forwarded_or_automated";
        case "empty-telegram-text":
            return "empty_text";
        case "empty-telegram-title":
            return "empty_title";
        case "invalid-telegram-title":
            return "invalid_title";
        case "empty-telegram-description":
            return "empty_description";
        case "telegram-description-too-short":
            return "description_too_short";
        case "invalid-telegram-listing-price":
        case "invalid-price":
            return "invalid_price";
        case "missing-telegram-listing-price":
            return "missing_price";
        case "invalid-telegram-offer-type":
        case "invalid-offer-type":
            return "invalid_offer_type";
        case "conflicting-telegram-offer-type":
            return "conflicting_offer_price";
        case "telegram-message-too-long":
            return "message_too_long";
        case "invalid-telegram-source-config":
        case "invalid-telegram-chat-config":
        case "source-rights-not-reviewed":
            return "invalid_source_configuration";
        default:
            return "validation_failed";
    }
}

const ALLOWED_RIGHTS_FIELDS = new Set<ExternalListingField>([
    "title", "originalUrl", "description", "price", "category", "location", "images", "publishedAt", "status", "contact",
]);

function asObject(value: unknown): JsonObject | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as JsonObject
        : null;
}

function requiredText(value: unknown, maxLength: number): string {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
        throw new Error("invalid-telegram-source-config");
    }
    return value.trim();
}

export function isTelegramListingsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    const importEnabled = env.TELEGRAM_LISTINGS_IMPORT_ENABLED;
    if (importEnabled !== undefined) {
        if (importEnabled !== "true" && importEnabled !== "false") {
            throw new Error("invalid-telegram-import-switch");
        }
        return importEnabled === "true";
    }

    // Preserve the original behavior unless the new independent import switch is configured.
    return env.TELEGRAM_LISTINGS_ENABLED === "true" && env.EXTERNAL_LISTINGS_ENABLED === "true";
}

/** Visibility remains tied to the established shared catalog switches. */
export function isTelegramListingsCatalogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.TELEGRAM_LISTINGS_ENABLED === "true" && env.EXTERNAL_LISTINGS_ENABLED === "true";
}

/**
 * Per-chat rights are explicit and fail closed. A chat is never inferred from an incoming update.
 * Permission must cover the posts' authors and every retained field, not merely the channel owner.
 */
export function loadTelegramListingsConfig(env: NodeJS.ProcessEnv = process.env): TelegramListingsConfig | null {
    if (!isTelegramListingsEnabled(env)) return null;
    const globalAutoPublish = env.TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED === "true";
    if (env.TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED !== undefined &&
        env.TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED !== "true" &&
        env.TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED !== "false") {
        throw new Error("invalid-telegram-auto-publish-switch");
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(env.TELEGRAM_LISTINGS_CHATS_JSON ?? "");
    } catch {
        throw new Error("invalid-telegram-chat-config");
    }
    const configuredChats = asObject(parsed);
    if (!configuredChats || Object.keys(configuredChats).length === 0 || Object.keys(configuredChats).length > 100) {
        throw new Error("invalid-telegram-chat-config");
    }

    const chats = new Map<string, TelegramChatSource>();
    for (const [chatId, rawConfig] of Object.entries(configuredChats)) {
        if (!/^-?\d{5,20}$/.test(chatId)) throw new Error("invalid-telegram-chat-config");
        const chat = asObject(rawConfig);
        if (!chat) throw new Error("invalid-telegram-chat-config");
        const publicUsername = requiredText(chat.publicUsername, 32).replace(/^@/, "");
        if (!/^[A-Za-z0-9_]{5,32}$/.test(publicUsername)) throw new Error("invalid-telegram-chat-config");
        const chatType = chat.chatType;
        if (chatType !== undefined && chatType !== "group" && chatType !== "supergroup" && chatType !== "channel") {
            throw new Error("invalid-telegram-chat-config");
        }
        const allowedSenderIdsValue = chat.allowedSenderIds;
        if (allowedSenderIdsValue !== undefined && (!Array.isArray(allowedSenderIdsValue) ||
            !allowedSenderIdsValue.every((id) => typeof id === "string" && /^[1-9]\d{0,15}$/.test(id) && Number.isSafeInteger(Number(id))))) {
            throw new Error("invalid-telegram-chat-config");
        }
        const rightsFields = chat.rightsFields;
        const reviewedAt = chat.rightsReviewedAt;
        const mappings = asObject(chat.categoryMappings ?? {});
        if (!Array.isArray(rightsFields) || !rightsFields.every((field) => typeof field === "string" && ALLOWED_RIGHTS_FIELDS.has(field as ExternalListingField)) ||
            typeof reviewedAt !== "number" || !Number.isFinite(reviewedAt) || reviewedAt <= 0 || !mappings) {
            throw new Error("invalid-telegram-chat-config");
        }
        const sourceId = `telegram_${createHash("sha256").update(chatId).digest("hex").slice(0, 20)}`;
        const source: ExternalListingSource = {
            id: sourceId,
            displayName: requiredText(chat.displayName, 120),
            allowedListingHosts: ["t.me"],
            allowedImageHosts: [],
            rights: {
                reference: requiredText(chat.rightsReference, 2048),
                reviewedAt,
                permissionConfirmed: chat.permissionConfirmed === true,
                fields: rightsFields as ExternalListingField[],
            },
            categoryMappings: mappings as ExternalListingSource["categoryMappings"],
        };
        validateExternalListingSource(source);
        if (chat.autoPublish !== undefined && typeof chat.autoPublish !== "boolean") {
            throw new Error("invalid-telegram-chat-config");
        }
        const maxUpdatesPerMinute = chat.maxUpdatesPerMinute ?? 30;
        if (!Number.isSafeInteger(maxUpdatesPerMinute) || (maxUpdatesPerMinute as number) < 1 || (maxUpdatesPerMinute as number) > 60) {
            throw new Error("invalid-telegram-chat-config");
        }
        chats.set(chatId, {
            chatId,
            publicUsername,
            ...(chatType !== undefined ? { chatType } : {}),
            ...(Array.isArray(allowedSenderIdsValue) ? { allowedSenderIds: new Set(allowedSenderIdsValue as string[]) } : {}),
            // Publishing requires both the global kill switch and an explicit per-chat opt-in.
            autoPublish: globalAutoPublish && chat.autoPublish === true,
            maxUpdatesPerMinute: maxUpdatesPerMinute as number,
            source,
        });
    }
    return { enabled: true, chats };
}

function getChatId(value: unknown): string | undefined {
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
    if (typeof value === "string" && /^-?\d{5,20}$/.test(value)) return value;
    return undefined;
}

function isObject(value: unknown): value is JsonObject {
    return asObject(value) !== null;
}

const META_LINE = /^(?:категорія|категория|kategoria|category|ціна|цена|cena|price|тип пропозиції|тип предложения|typ oferty|offer type|offer)\s*:/i;
const CONTENT_CHARACTERS = /[A-Za-zÀ-žА-Яа-яІіЇїЄєҐґ]/u;

type ValidTelegramMessage = {
    message: JsonObject;
    chatId: string;
    messageId: number;
    publishedAt: number;
    sourceUrl: string;
    normalizedText: string;
    senderUnverified: boolean;
};

function validateTelegramMessage(value: unknown, chatSource: TelegramChatSource, allowChannelWithoutSender = false): ValidTelegramMessage {
    if (!isObject(value)) throw new Error("invalid-telegram-message");
    const message = value;
    const chat = asObject(message.chat);
    if (!chat) throw new Error("invalid-telegram-message");
    const chatId = getChatId(chat.id);
    if (chatId !== chatSource.chatId || !["group", "supergroup", "channel"].includes(String(chat.type))) {
        throw new Error("unapproved-telegram-chat");
    }
    if (chatSource.chatType !== undefined && chat.type !== chatSource.chatType) {
        throw new Error("telegram-chat-type-mismatch");
    }
    const username = typeof chat.username === "string" ? chat.username : "";
    if (username.toLowerCase() !== chatSource.publicUsername.toLowerCase()) throw new Error("telegram-public-link-unavailable");
    if (message.forward_origin !== undefined || message.forward_from !== undefined || message.is_automatic_forward === true ||
        message.via_bot !== undefined || (isObject(message.from) && message.from.is_bot === true)) {
        throw new Error("forwarded-or-automated-telegram-message");
    }

    let senderUnverified = false;
    if (chatSource.allowedSenderIds !== undefined) {
        const sender = asObject(message.from);
        const senderId = sender && Number.isSafeInteger(sender.id) && (sender.id as number) > 0
            ? String(sender.id)
            : undefined;
        if (senderId) {
            if (!chatSource.allowedSenderIds.has(senderId)) throw new Error("unapproved-telegram-sender");
        } else if (allowChannelWithoutSender && chat.type === "channel") {
            // Channel posts can omit `from`; the allowlisted channel still identifies the source,
            // but the importer will require human review because the author cannot be checked.
            senderUnverified = true;
        } else {
            throw new Error("unapproved-telegram-sender");
        }
    }

    if (!Number.isSafeInteger(message.message_id) || (message.message_id as number) <= 0) {
        throw new Error("invalid-telegram-message-id");
    }
    if (!Number.isSafeInteger(message.date) || (message.date as number) <= 0) {
        throw new Error("invalid-telegram-message-date");
    }
    const rawText = typeof message.text === "string" && message.text.trim()
        ? message.text
        : typeof message.caption === "string" ? message.caption : "";
    const normalizedText = rawText.replace(/\uFEFF/g, "").replace(/\r/g, "").trim();
    if (normalizedText.length > 15_000) throw new Error("telegram-message-too-long");

    const threadId = message.message_thread_id;
    if (threadId !== undefined && (!Number.isSafeInteger(threadId) || (threadId as number) <= 0)) {
        throw new Error("invalid-telegram-message-thread-id");
    }
    const messagePath = threadId === undefined
        ? String(message.message_id)
        : `${threadId as number}/${message.message_id as number}`;
    return {
        message,
        chatId,
        messageId: message.message_id as number,
        publishedAt: (message.date as number) * 1000,
        sourceUrl: `https://t.me/${chatSource.publicUsername}/${messagePath}`,
        normalizedText,
        senderUnverified,
    };
}

function parseExplicitPrice(line: string): number {
    const match = line.match(/^(?:цена|cena|price)\s*:\s*([\d ]+(?:[.,]\d{1,2})?)\s*(?:PLN|zł|zl)$/i);
    if (!match) throw new Error("invalid-telegram-listing-price");
    const numeric = match[1].replace(/\s/g, "").replace(",", ".");
    const amount = Number(numeric);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("invalid-telegram-listing-price");
    return amount;
}

export function mapTelegramMessageCandidate(value: unknown, chatSource: TelegramChatSource): ExternalListingCandidate {
    const validated = validateTelegramMessage(value, chatSource);
    const { chatId, publishedAt, sourceUrl, normalizedText } = validated;
    if (!normalizedText) throw new Error("empty-telegram-text");
    if (normalizedText.length > 15_000) throw new Error("telegram-message-too-long");
    const lines = normalizedText.split("\n").map((line) => line.trim()).filter(Boolean);
    const titleIndex = lines.findIndex((line) => !META_LINE.test(line));
    if (titleIndex < 0) throw new Error("empty-telegram-title");
    const title = lines[titleIndex].replace(/^#+\s*/, "").trim();
    const metadataLines = lines.filter((line) => META_LINE.test(line));
    const description = lines.filter((_, index) => index !== titleIndex && !META_LINE.test(lines[index]))
        .join("\n").trim();
    const textContent = `${title} ${description}`.replace(/https?:\/\/\S+/gi, " ").trim();
    const urlCount = (normalizedText.match(/https?:\/\//gi) ?? []).length;
    if (title.length < 8) throw new Error("invalid-telegram-title");
    if (!description) throw new Error("empty-telegram-description");
    if (description.length < 20) throw new Error("telegram-description-too-short");
    if (!CONTENT_CHARACTERS.test(textContent) || urlCount > 3) throw new Error("insufficient-telegram-listing-information");

    const source = chatSource.source;
    const candidate: ExternalListingCandidate = {
        sourceListingId: createTelegramContentId(chatId, title, description, metadataLines),
        originalUrl: sourceUrl,
        title,
        // There is no spam classifier or Telegram moderation UI in this project; hidden review is the safe default.
        requiresReview: !chatSource.autoPublish,
    };
    if (source.rights.fields.includes("description")) {
        const safeDescription = description.replace(/https?:\/\/\S+/gi, "").replace(/[ \t]+\n/g, "\n").trim();
        if (safeDescription) candidate.description = safeDescription;
    }
    if (source.rights.fields.includes("publishedAt")) candidate.sourcePublishedAt = publishedAt;

    if (source.rights.fields.includes("category")) {
        const categoryLine = metadataLines.find((line) => /^(?:категория|kategoria|category)\s*:/i.test(line));
        if (categoryLine) candidate.sourceCategory = categoryLine.replace(/^[^:]+:\s*/, "").trim().toLowerCase();
    }
    if (source.rights.fields.includes("price")) {
        const priceLine = metadataLines.find((line) => /^(?:цена|cena|price)\s*:/i.test(line));
        const offerLine = metadataLines.find((line) => /^(?:тип предложения|typ oferty|offer type|offer)\s*:/i.test(line));
        const explicitOffer = offerLine?.replace(/^[^:]+:\s*/, "").trim().toLowerCase();
        const offerType = explicitOffer === "free" || explicitOffer === "бесплатно" || explicitOffer === "darmowe"
            ? "free"
            : explicitOffer === "exchange" || explicitOffer === "обмен" || explicitOffer === "wymiana"
                ? "exchange"
                : explicitOffer === "paid" || explicitOffer === "платно" || explicitOffer === "płatne"
                    ? "paid"
                    : undefined;
        if (explicitOffer && !offerType) throw new Error("invalid-telegram-offer-type");
        if (priceLine) {
            if (offerType === "free" || offerType === "exchange") throw new Error("conflicting-telegram-offer-type");
            candidate.offerType = "paid";
            candidate.priceAmount = parseExplicitPrice(priceLine);
            candidate.currency = "PLN";
        } else if (offerType) {
            if (offerType === "paid") throw new Error("missing-telegram-listing-price");
            candidate.offerType = offerType;
        }
    }
    return candidate;
}

export type ParsedTelegramAd = {
    chatId: string;
    messageId: number;
    sourceId: string;
    sourceName: string;
    sourceUrl: string;
    publishedAt: number;
    contentHash: string;
    title: string;
    description: string;
    category?: ExternalListingCategory;
    catalogCategory?: string;
    catalogSubcategory?: string;
    priceType?: "paid" | "free" | "exchange";
    price?: string;
    exchangeDetails?: string;
    city?: string;
    voivodeship?: string;
    sellerContact?: string;
    photoFileIds: string[];
    reviewReasons: string[];
    autoPublishEligible: boolean;
};

const TITLE_LINE = /^(?:заголовок|назва|название|tytuł|title)\s*:\s*/i;
const CATEGORY_LINE = /^(?:категорія|категория|kategoria|category)\s*:\s*/i;
const PRICE_LINE = /^(?:ціна|цена|cena|price)\s*:\s*/i;
const OFFER_LINE = /^(?:тип пропозиції|тип предложения|typ oferty|offer type|offer)\s*:\s*/i;
const CITY_LINE = /^(?:місто|город|miasto|city)\s*:\s*/i;
const VOIVODESHIP_LINE = /^(?:воєводство|воеводство|województwo|voivodeship)\s*:\s*/i;
const CONTACT_LINE = /^(?:контакт|контакти|телефон|номер телефону|kontakt|telefon|contact|phone|telegram|e-?mail|mail)\s*:\s*/i;
const EXCHANGE_LINE = /^(?:обмін на|wymiana na|exchange for)\s*:\s*/i;
const KNOWN_META_LINE = /^(?:заголовок|назва|название|tytuł|title|категорія|категория|kategoria|category|ціна|цена|cena|price|тип пропозиції|тип предложения|typ oferty|offer type|offer|місто|город|miasto|city|воєводство|воеводство|województwo|voivodeship|контакт|контакти|телефон|номер телефону|kontakt|telefon|contact|phone|telegram|e-?mail|mail|обмін на|wymiana na|exchange for)\s*:/i;

function afterLabel(line: string, pattern: RegExp): string {
    return line.replace(pattern, "").trim();
}

function parseExplicitOffer(value: string | undefined): "paid" | "free" | "exchange" | undefined {
    if (!value) return undefined;
    const normalized = value.trim().toLowerCase();
    if (["paid", "платно", "płatne"].includes(normalized)) return "paid";
    if (["free", "безкоштовно", "бесплатно", "darmowe", "za darmo"].includes(normalized)) return "free";
    if (["exchange", "обмін", "обмен", "wymiana"].includes(normalized)) return "exchange";
    return undefined;
}

function parseExplicitPriceValue(value: string): { priceType: "paid" | "free" | "exchange"; price?: string } | null {
    const normalized = value.trim().toLowerCase();
    if (["free", "безкоштовно", "бесплатно", "darmowe", "za darmo"].includes(normalized)) return { priceType: "free" };
    if (["exchange", "обмін", "обмен", "wymiana"].includes(normalized)) return { priceType: "exchange" };
    const match = value.match(/^\s*([+-]?[\d\s\u00a0]+(?:[.,]\d{1,2})?)\s*(PLN|zł|zl)\s*$/i);
    if (!match) return null;
    const numeric = match[1].replace(/[\s\u00a0]/g, "").replace(",", ".");
    const amount = Number(numeric);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return { priceType: "paid", price: `${amount} zł` };
}

function validExplicitContact(value: string): boolean {
    const contact = value.trim();
    return contact.length > 0 && contact.length <= 120 &&
        (/^\+?[\d\s().-]{6,24}$/.test(contact) || /^@?[A-Za-z0-9_]{5,32}$/.test(contact) ||
            /^telegram\s*:\s*@?[A-Za-z0-9_]{5,32}$/i.test(contact) ||
            /^(?:email\s*:\s*)?[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(contact));
}

/** Tolerant extraction for the Telegram-to-ads flow. Uncertain fields become review reasons. */
export function parseTelegramAdMessage(value: unknown, chatSource: TelegramChatSource): ParsedTelegramAd {
    const validated = validateTelegramMessage(value, chatSource, true);
    const { message, chatId, messageId, publishedAt, sourceUrl, normalizedText, senderUnverified } = validated;
    const lines = normalizedText.split("\n").map((line) => line.trim()).filter(Boolean);
    const reasons = new Set<string>();
    if (senderUnverified) reasons.add("sender_unverified");
    if (!normalizedText) reasons.add("missing_text");

    const titleLine = lines.find((line) => TITLE_LINE.test(line));
    const contentLines = lines.filter((line) => !KNOWN_META_LINE.test(line));
    const title = (titleLine ? afterLabel(titleLine, TITLE_LINE) : contentLines[0] ?? "").replace(/^#+\s*/, "").trim();
    const descriptionLines = contentLines.filter((_, index) => titleLine ? true : index > 0);
    const description = descriptionLines.join("\n").replace(/https?:\/\/\S+/gi, "").trim();
    if (!title || title.length < 8) reasons.add("missing_or_short_title");
    if (!description || description.length < 20) reasons.add("missing_or_short_description");
    if (title.length > 200) reasons.add("title_too_long");
    if (description.length > 5000) reasons.add("description_too_long");
    if (/https?:\/\//i.test(normalizedText)) reasons.add("external_link_requires_review");
    if (/\b(?:crypto|krypto|крипто|криптовалют\w*|инвестиц\w*|inwestycj\w*|loan offer|кредит без|легкий заробіток|łatwy zarobek)\b/i.test(normalizedText)) {
        reasons.add("spam_signal_requires_review");
    }

    const categoryLine = lines.find((line) => CATEGORY_LINE.test(line));
    const sourceCategory = categoryLine ? afterLabel(categoryLine, CATEGORY_LINE).toLowerCase() : "";
    let category: ExternalListingCategory | undefined;
    let catalogCategory: string | undefined;
    let catalogSubcategory: string | undefined;
    if (!chatSource.source.rights.fields.includes("category")) {
        reasons.add("category_not_authorized");
    } else if (!sourceCategory) {
        reasons.add("category_missing");
    } else {
        const mapping = chatSource.source.categoryMappings[sourceCategory];
        if (!mapping || !mapping.category) reasons.add("category_unmapped");
        else {
            category = mapping.category;
            catalogCategory = mapping.catalogCategory;
            catalogSubcategory = mapping.catalogSubcategory;
        }
    }

    const priceLine = lines.find((line) => PRICE_LINE.test(line));
    const offerLine = lines.find((line) => OFFER_LINE.test(line));
    let priceType = parseExplicitOffer(offerLine ? afterLabel(offerLine, OFFER_LINE) : undefined);
    if (offerLine && !priceType) reasons.add("offer_type_unknown");
    let price: string | undefined;
    const exchangeLine = lines.find((line) => EXCHANGE_LINE.test(line));
    const exchangeDetails = exchangeLine ? afterLabel(exchangeLine, EXCHANGE_LINE).slice(0, 200) : undefined;
    if (!chatSource.source.rights.fields.includes("price")) {
        reasons.add("price_not_authorized");
    } else if (priceLine) {
        const parsedPrice = parseExplicitPriceValue(afterLabel(priceLine, PRICE_LINE));
        if (!parsedPrice) reasons.add("price_invalid_or_currency_unknown");
        else if (priceType && priceType !== parsedPrice.priceType) reasons.add("offer_price_conflict");
        else {
            priceType = parsedPrice.priceType;
            price = parsedPrice.price;
        }
    }
    if (!priceType) reasons.add("offer_type_unknown");
    if (priceType === "paid" && !price) reasons.add("paid_price_missing");
    if (priceType !== "paid") price = undefined;

    const cityLine = lines.find((line) => CITY_LINE.test(line));
    const voivodeshipLine = lines.find((line) => VOIVODESHIP_LINE.test(line));
    const city = cityLine ? afterLabel(cityLine, CITY_LINE).slice(0, 120) : undefined;
    const voivodeship = voivodeshipLine ? afterLabel(voivodeshipLine, VOIVODESHIP_LINE).slice(0, 120) : undefined;
    if (!chatSource.source.rights.fields.includes("location")) reasons.add("location_not_authorized");
    else {
        if (!city) reasons.add("city_missing");
        if (!voivodeship) reasons.add("voivodeship_missing");
    }

    const contactLine = lines.find((line) => CONTACT_LINE.test(line));
    let sellerContact: string | undefined;
    if (contactLine) {
        if (!chatSource.source.rights.fields.includes("contact")) reasons.add("contact_not_authorized");
        else {
            const contact = afterLabel(contactLine, CONTACT_LINE);
            if (!validExplicitContact(contact)) reasons.add("contact_ambiguous");
            else sellerContact = contact;
        }
    }

    const photoSizes = Array.isArray(message.photo) ? message.photo : [];
    const photoFileIds = photoSizes
        .filter((photo) => isObject(photo) && typeof photo.file_id === "string" && photo.file_id.length <= 256)
        .slice(-1)
        .map((photo) => (photo as JsonObject).file_id as string);
    if (photoFileIds.length && !chatSource.source.rights.fields.includes("images")) reasons.add("images_not_authorized");
    if (!chatSource.source.rights.fields.includes("description")) reasons.add("description_not_authorized");
    if (!chatSource.source.rights.fields.includes("title") || !chatSource.source.rights.fields.includes("originalUrl")) {
        reasons.add("required_fields_not_authorized");
    }

    const unknownMeta = lines.some((line) => /^[^:]{2,40}:\s*\S/.test(line) && !KNOWN_META_LINE.test(line));
    if (unknownMeta) reasons.add("unrecognized_metadata");
    if (!chatSource.autoPublish) reasons.add("auto_publish_disabled");

    const normalizedContent = `${title}\0${description}\0${sourceCategory}\0${priceType ?? ""}\0${price ?? ""}\0${photoFileIds.join("\0")}`
        .normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
    const contentHash = createHash("sha256").update(normalizedContent).digest("hex");
    const autoPublishEligible = chatSource.autoPublish && reasons.size === 0;

    return {
        chatId,
        messageId,
        sourceId: chatSource.source.id,
        sourceName: chatSource.source.displayName ?? "Telegram",
        sourceUrl,
        publishedAt,
        contentHash,
        title: chatSource.source.rights.fields.includes("title") ? title.slice(0, 200) : "",
        description: chatSource.source.rights.fields.includes("description") ? description.slice(0, 5000) : "",
        ...(category ? { category } : {}),
        ...(catalogCategory ? { catalogCategory } : {}),
        ...(catalogSubcategory ? { catalogSubcategory } : {}),
        ...(priceType ? { priceType } : {}),
        ...(price ? { price } : {}),
        ...(exchangeDetails && priceType === "exchange" ? { exchangeDetails } : {}),
        ...(city && chatSource.source.rights.fields.includes("location") ? { city } : {}),
        ...(voivodeship && chatSource.source.rights.fields.includes("location") ? { voivodeship } : {}),
        ...(sellerContact ? { sellerContact } : {}),
        photoFileIds: chatSource.source.rights.fields.includes("images") ? photoFileIds : [],
        reviewReasons: Array.from(reasons),
        autoPublishEligible,
    };
}

function createTelegramContentId(chatId: string, title: string, description: string, metadataLines: string[]): string {
    const identity = `${title}\0${description}\0${metadataLines.join("\n")}`
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    return `${chatId}_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

export function createTelegramMessageAdapter(
    update: JsonObject,
    chatSource: TelegramChatSource,
): ExternalListingAdapter {
    const message = getTelegramUpdateMessage(update);
    if (!message) throw new Error("unsupported-telegram-update");
    return {
        source: chatSource.source,
        providesCompleteSnapshot: false,
        async fetchPage(): Promise<ExternalListingPage> {
            return { items: [message], hasMore: false };
        },
        mapCandidate: (item) => mapTelegramMessageCandidate(item, chatSource),
    };
}

export function getTelegramUpdateId(value: unknown): number | undefined {
    if (!isObject(value) || !Number.isSafeInteger(value.update_id) || (value.update_id as number) < 0) return undefined;
    return value.update_id as number;
}

export function getTelegramUpdateMessage(value: unknown): JsonObject | null {
    if (!isObject(value)) return null;
    for (const key of ["message", "channel_post", "edited_message", "edited_channel_post"]) {
        if (isObject(value[key])) return value[key] as JsonObject;
    }
    return null;
}

export function isTelegramEditedUpdate(value: unknown): boolean {
    return isObject(value) && (isObject(value.edited_message) || isObject(value.edited_channel_post));
}

export function getTelegramUpdateChatId(value: unknown): string | undefined {
    if (!isObject(value)) return undefined;
    const message = getTelegramUpdateMessage(value);
    if (!message || !isObject(message.chat)) return undefined;
    return getChatId(message.chat.id);
}
