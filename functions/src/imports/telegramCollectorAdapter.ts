import { createHash } from "node:crypto";
import { createTelegramCollectorUpdateKey } from "./telegramCollectorSecurity";
import type { TelegramChatSource } from "./telegramListingsAdapter";

const MAX_TEXT_LENGTH = 15_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
const CHAT_ID_PATTERN = /^-[1-9]\d{1,15}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;

type JsonObject = Record<string, unknown>;

/** Telethon-originated messages need a source-specific sender allowlist in addition to HMAC. */
export function hasExplicitTelegramCollectorSenderAllowlist(source: Pick<TelegramChatSource, "allowedSenderIds">): boolean {
    return Boolean(source.allowedSenderIds && source.allowedSenderIds.size > 0);
}

export type TelegramCollectorUpdate = {
    update: JsonObject;
    updateId: string;
    photoBytes: Buffer[];
    photoUnavailable: boolean;
};

function isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonObject, allowed: readonly string[]): boolean {
    return Object.keys(value).every((key) => allowed.includes(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function decodeImage(value: unknown): Buffer {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_IMAGE_BASE64_LENGTH ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw new Error("invalid-collector-payload");
    }
    const bytes = Buffer.from(value, "base64");
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== value) {
        throw new Error("invalid-collector-payload");
    }
    return bytes;
}

/** Converts a narrowly defined Telethon envelope to a server-created Bot API-shaped update. */
export function buildTelegramUpdateFromCollectorPayload(
    value: unknown,
    rawBody: Buffer,
    nowSeconds = Math.floor(Date.now() / 1000),
): TelegramCollectorUpdate {
    if (!isObject(value) || !hasOnlyKeys(value, ["version", "chat", "message"]) || value.version !== 1 ||
        !isObject(value.chat) || !hasOnlyKeys(value.chat, ["id", "type", "username"]) ||
        !isObject(value.message) || !hasOnlyKeys(value.message, [
            "id", "date", "text", "senderId", "threadId", "groupedId", "photos", "photoExpected", "edited",
        ])) {
        throw new Error("invalid-collector-payload");
    }

    const chat = value.chat;
    const message = value.message;
    if (typeof chat.id !== "string" || !CHAT_ID_PATTERN.test(chat.id) || !Number.isSafeInteger(Number(chat.id)) ||
        (chat.type !== "group" && chat.type !== "supergroup" && chat.type !== "channel") ||
        (chat.username !== null && (typeof chat.username !== "string" || !USERNAME_PATTERN.test(chat.username))) ||
        !isPositiveSafeInteger(message.id) || !isPositiveSafeInteger(message.date) ||
        message.date > nowSeconds + 300 || typeof message.text !== "string" || message.text.length > MAX_TEXT_LENGTH ||
        (message.senderId !== null && !isPositiveSafeInteger(message.senderId)) ||
        (message.threadId !== null && !isPositiveSafeInteger(message.threadId)) ||
        (message.groupedId !== null && (typeof message.groupedId !== "string" || !/^\d{1,20}$/.test(message.groupedId))) ||
        typeof message.photoExpected !== "boolean" || typeof message.edited !== "boolean" ||
        !Array.isArray(message.photos) || message.photos.length > 1 || (!message.photoExpected && message.photos.length > 0)) {
        throw new Error("invalid-collector-payload");
    }

    const photoBytes = message.photos.map(decodeImage);
    const telegramMessage: JsonObject = {
        message_id: message.id,
        date: message.date,
        text: message.text,
        chat: {
            id: Number(chat.id),
            type: chat.type,
            ...(typeof chat.username === "string" ? { username: chat.username } : {}),
        },
        ...(message.senderId !== null ? { from: { id: message.senderId, is_bot: false } } : {}),
        ...(message.threadId !== null ? { message_thread_id: message.threadId } : {}),
        ...(message.groupedId !== null ? { media_group_id: message.groupedId } : {}),
    };

    if (message.photoExpected) {
        const fileId = photoBytes.length
            ? `collector:${createHash("sha256").update(photoBytes[0]).digest("hex")}`
            : "collector:media-unavailable";
        telegramMessage.photo = [{ file_id: fileId, width: 1, height: 1 }];
    }

    return {
        update: message.edited ? { edited_message: telegramMessage } : { message: telegramMessage },
        updateId: createTelegramCollectorUpdateKey(rawBody),
        photoBytes,
        photoUnavailable: message.photoExpected && photoBytes.length === 0,
    };
}
