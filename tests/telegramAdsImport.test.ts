import assert from "node:assert/strict";
import test from "node:test";
import {
    getTelegramUpdateMessage,
    isTelegramEditedUpdate,
    loadTelegramListingsConfig,
    parseTelegramAdMessage,
} from "../functions/src/imports/telegramListingsAdapter";
import { storeTelegramPhotos } from "../functions/src/imports/telegramAds";
import { listTelegramModerationItems, moderateTelegramImport } from "../functions/src/imports/telegramAds";
import type { Firestore } from "firebase-admin/firestore";

const chatId = "-1001234567890";
const messageDate = Math.floor(Date.now() / 1000) - 60;
const config = loadTelegramListingsConfig({
    TELEGRAM_LISTINGS_IMPORT_ENABLED: "true",
    TELEGRAM_LISTINGS_ENABLED: "false",
    EXTERNAL_LISTINGS_ENABLED: "false",
    TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED: "true",
    TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
        [chatId]: {
            displayName: "Synthetic test source",
            publicUsername: "xoven_test_source",
            chatType: "supergroup",
            allowedSenderIds: ["8519508488"],
            rightsReference: "https://t.me/xoven_test_source",
            rightsReviewedAt: 1_800_000_000_000,
            permissionConfirmed: true,
            autoPublish: true,
            maxUpdatesPerMinute: 5,
            rightsFields: ["title", "originalUrl", "description", "price", "category", "location", "images", "publishedAt", "contact"],
            categoryMappings: {
                transport: { category: "sell", catalogCategory: "transport", catalogSubcategory: "other" },
            },
        },
    }),
});
assert.ok(config);
const source = config.chats.get(chatId);
assert.ok(source);

function message(text: string, overrides: Record<string, unknown> = {}) {
    return {
        message_id: 17,
        date: messageDate,
        chat: { id: Number(chatId), type: "supergroup", username: "xoven_test_source" },
        from: { id: 8519508488, is_bot: false },
        text,
        ...overrides,
    };
}

const completeText = [
    "Продам тестовый велосипед",
    "Велосипед в хорошем состоянии. Всё работает исправно. Это синтетическая проверка импорта объявлений.",
    "Категорія: transport",
    "Тип пропозиції: paid",
    "Ціна: 100 zł",
    "Місто: Варшава",
    "Воєводство: Мазовецьке",
    "Контакт: +48123456789",
].join("\n");

test("a complete synthetic listing maps to the regular-ad fields and remains eligible only with explicit data", () => {
    const parsed = parseTelegramAdMessage(message(completeText), source);
    assert.equal(parsed.title, "Продам тестовый велосипед");
    assert.match(parsed.description, /Велосипед в хорошем состоянии/);
    assert.equal(parsed.category, "sell");
    assert.equal(parsed.catalogCategory, "transport");
    assert.equal(parsed.priceType, "paid");
    assert.equal(parsed.price, "100 zł");
    assert.equal(parsed.city, "Варшава");
    assert.equal(parsed.voivodeship, "Мазовецьке");
    assert.equal(parsed.sellerContact, "+48123456789");
    assert.equal(parsed.autoPublishEligible, true);
    assert.deepEqual(parsed.reviewReasons, []);
    assert.equal(parsed.sourceUrl, "https://t.me/xoven_test_source/17");
});

test("caption and channel_post are supported, including channel posts without from.id", () => {
    const channelSource = { ...source, chatType: "channel" as const };
    const update = {
        update_id: 71,
        channel_post: {
            ...message(completeText, { from: undefined, text: undefined, caption: completeText }),
            chat: { id: Number(chatId), type: "channel", username: "xoven_test_source" },
        },
    };
    assert.equal(getTelegramUpdateMessage(update)?.caption, completeText);
    const parsed = parseTelegramAdMessage(getTelegramUpdateMessage(update), channelSource);
    assert.ok(parsed.reviewReasons.includes("sender_unverified"));
    assert.equal(parsed.autoPublishEligible, false);
});

test("missing text, short content, unknown category, price, and offer type stay in review", () => {
    const photoOnly = message("", { caption: "", photo: [{ file_id: "file-id" }] });
    const empty = parseTelegramAdMessage(photoOnly, source);
    assert.ok(empty.reviewReasons.includes("missing_text"));
    assert.equal(empty.autoPublishEligible, false);

    const unknown = parseTelegramAdMessage(message([
        "Продам тестовый велосипед",
        "Достаточно длинный текст описания для проверки ручной модерации входящего сообщения.",
        "Категорія: непідтримувана",
        "Тип пропозиції: maybe",
        "Ціна: 100 EUR",
        "Місто: Варшава",
        "Воєводство: Мазовецьке",
    ].join("\n")), source);
    assert.ok(unknown.reviewReasons.includes("category_unmapped"));
    assert.ok(unknown.reviewReasons.includes("offer_type_unknown"));
    assert.ok(unknown.reviewReasons.includes("price_invalid_or_currency_unknown"));
    assert.equal(unknown.autoPublishEligible, false);
});

test("free and exchange listings are recognized without inventing a price", () => {
    const base = [
        "Объявление о полезной вещи",
        "Подробное описание объявления достаточно длинное для проверки типов предложения.",
        "Категория: transport",
        "Місто: Варшава",
        "Воєводство: Мазовецьке",
    ];
    const free = parseTelegramAdMessage(message([...base, "Тип пропозиції: безкоштовно"].join("\n")), source);
    assert.equal(free.priceType, "free");
    assert.equal(free.price, undefined);
    const exchange = parseTelegramAdMessage(message([...base, "Тип пропозиції: wymiana", "Обмін на: дитячий велосипед"].join("\n")), source);
    assert.equal(exchange.priceType, "exchange");
    assert.equal(exchange.exchangeDetails, "дитячий велосипед");
});

test("edited update kinds retain the stable message object", () => {
    const update = { edited_channel_post: message(completeText) };
    assert.equal(isTelegramEditedUpdate(update), true);
    assert.equal(getTelegramUpdateMessage(update)?.message_id, 17);
    assert.equal(isTelegramEditedUpdate({ message: message(completeText) }), false);
});

test("Telegram moderation reads and writes reject unauthenticated or unverified non-admin users", async () => {
    const unusableDb = {} as Firestore;
    await assert.rejects(listTelegramModerationItems(unusableDb, undefined), { code: "unauthenticated" });
    await assert.rejects(moderateTelegramImport(unusableDb, undefined, {}), { code: "unauthenticated" });
    await assert.rejects(listTelegramModerationItems(unusableDb, {
        token: { email: "not-an-admin@example.test", email_verified: true },
    }), { code: "permission-denied" });
    await assert.rejects(moderateTelegramImport(unusableDb, {
        token: { email: "ozenenesis56@gmail.com", email_verified: false },
    }, {}), { code: "permission-denied" });
});

test("Telegram photos are size limited, signature checked, and uploaded through the injected Storage boundary", async () => {
    const photoMessage = message(completeText, { photo: [{ file_id: "telegram-file" }] });
    const parsed = parseTelegramAdMessage(photoMessage, source);
    const saved: string[] = [];
    const deleted: string[] = [];
    const storage = {
        async save(path: string) { saved.push(path); return `https://firebasestorage.googleapis.com/v0/b/test/o/${encodeURIComponent(path)}?token=test`; },
        async delete(paths: string[]) { deleted.push(...paths); },
    };
    const fetchImplementation: typeof fetch = async (input) => String(input).includes("getFile")
        ? new Response(JSON.stringify({ ok: true, result: { file_path: "photos/test.jpg" } }), { status: 200 })
        : new Response(Buffer.from([0xff, 0xd8, 0xff, 0x00]), { status: 200, headers: { "content-type": "image/jpeg" } });
    const stored = await storeTelegramPhotos(parsed, `12345:${"a".repeat(32)}`, { fetchImplementation, storage });
    assert.equal(stored.urls.length, 1);
    assert.equal(saved.length, 1);
    assert.deepEqual(deleted, []);

    const unsupportedFetcher: typeof fetch = async (input) => String(input).includes("getFile")
        ? new Response(JSON.stringify({ ok: true, result: { file_path: "photos/test.bin" } }), { status: 200 })
        : new Response(Buffer.from([0, 1, 2, 3]), { status: 200 });
    await assert.rejects(storeTelegramPhotos(parsed, `12345:${"a".repeat(32)}`, {
        fetchImplementation: unsupportedFetcher,
        storage,
    }), /telegram-image-type-unsupported/);
});
