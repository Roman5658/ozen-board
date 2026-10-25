import assert from "node:assert/strict";
import test from "node:test";
import {
    getTelegramUpdateMessage,
    isTelegramEditedUpdate,
    loadTelegramListingsConfig,
    parseTelegramAdMessage,
} from "../functions/src/imports/telegramListingsAdapter";
import { getUnreferencedTelegramImagePaths, storeTelegramPhotoBytes, storeTelegramPhotos } from "../functions/src/imports/telegramAds";
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

test("explicit paid Telegram offers may omit the amount, but a numeric price does not guess the offer type", () => {
    const paidWithoutAmount = parseTelegramAdMessage(message(completeText.replace("Ціна: 100 zł\n", "")), source);
    assert.equal(paidWithoutAmount.priceType, "paid");
    assert.equal(paidWithoutAmount.price, undefined);
    assert.equal(paidWithoutAmount.autoPublishEligible, true);

    const amountWithoutType = parseTelegramAdMessage(message(completeText.replace("Тип пропозиції: paid\n", "")), source);
    assert.equal(amountWithoutType.priceType, undefined);
    assert.equal(amountWithoutType.price, "100 zł");
    assert.ok(amountWithoutType.reviewReasons.includes("offer_type_unknown"));
    assert.equal(amountWithoutType.autoPublishEligible, false);
});

test("Telegram revision fingerprints include all retained metadata and permission scope", () => {
    const original = parseTelegramAdMessage(message(completeText, { photo: [{ file_id: "same-photo" }] }), source);
    const changedLocation = parseTelegramAdMessage(
        message(completeText.replace("Місто: Варшава", "Місто: Краків"), { photo: [{ file_id: "same-photo" }] }),
        source,
    );
    const changedContact = parseTelegramAdMessage(
        message(completeText.replace("+48123456789", "+48987654321"), { photo: [{ file_id: "same-photo" }] }),
        source,
    );
    const restrictedRights = {
        ...source,
        source: {
            ...source.source,
            rights: {
                ...source.source.rights,
                fields: source.source.rights.fields.filter((field) => field !== "contact"),
            },
        },
    };
    const changedRights = parseTelegramAdMessage(message(completeText, { photo: [{ file_id: "same-photo" }] }), restrictedRights);

    assert.notEqual(changedLocation.contentHash, original.contentHash);
    assert.notEqual(changedContact.contentHash, original.contentHash);
    assert.notEqual(changedRights.contentHash, original.contentHash);
});

test("Telegram moderation cleanup retains published image paths and deletes only safe unreferenced paths", () => {
    const originalPath = `telegram-imports/${"a".repeat(64)}/${"b".repeat(64)}/0.jpg`;
    const revisionPath = `telegram-imports/${"a".repeat(64)}/${"c".repeat(64)}/0.png`;
    const unsafePath = "telegram-imports/../../outside.jpg";

    assert.deepEqual(
        getUnreferencedTelegramImagePaths(
            { imagePaths: [originalPath, revisionPath, unsafePath] },
            { imagePaths: [originalPath] },
        ),
        [revisionPath],
    );
    assert.deepEqual(getUnreferencedTelegramImagePaths({ imagePaths: [originalPath] }), [originalPath]);
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

test("missing required voivodeship is identified before trusted ad construction", () => {
    const withoutVoivodeship = parseTelegramAdMessage(
        message(completeText.replace("Воєводство: Мазовецьке\n", "")),
        source,
    );
    assert.ok(withoutVoivodeship.reviewReasons.includes("voivodeship_missing"));
    assert.equal(withoutVoivodeship.autoPublishEligible, false);
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

test("Telegram media-group posts are kept for review rather than published as separate ads", () => {
    const grouped = parseTelegramAdMessage(message(completeText, { media_group_id: "synthetic-album" }), source);
    assert.ok(grouped.reviewReasons.includes("media_group_requires_review"));
    assert.equal(grouped.autoPublishEligible, false);
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

test("collector photo bytes use the same server-side image validation and Storage boundary", async () => {
    const parsed = parseTelegramAdMessage(message(completeText, { photo: [{ file_id: "collector:synthetic" }] }), source);
    const saved: Array<{ path: string; contentType: string; bytes: Buffer }> = [];
    const deleted: string[][] = [];
    const storage = {
        async save(path: string, bytes: Buffer, contentType: string) {
            saved.push({ path, contentType, bytes });
            return `https://storage.example.test/${encodeURIComponent(path)}`;
        },
        async delete(paths: string[]) { deleted.push(paths); },
    };
    const image = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    const stored = await storeTelegramPhotoBytes(parsed, [image], { storage });
    assert.equal(stored.urls.length, 1);
    assert.equal(stored.paths.length, 1);
    assert.equal(saved[0].contentType, "image/jpeg");
    assert.deepEqual(saved[0].bytes, image);
    assert.match(saved[0].path, /^telegram-imports\/[a-f0-9]{64}\/[a-f0-9]{64}\/0\.jpg$/);

    await assert.rejects(storeTelegramPhotoBytes(parsed, [Buffer.from("not an image")], { storage }), {
        message: "telegram-image-type-unsupported",
    });
    assert.deepEqual(deleted, [[]]);
});
