import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deleteApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc } from "firebase/firestore";
import { ingestTelegramAd, moderateTelegramImport, createTelegramImportKey } from "../functions/src/imports/telegramAds";
import { loadTelegramListingsConfig, parseTelegramAdMessage } from "../functions/src/imports/telegramListingsAdapter";

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = "demo-ozen-board-stage-61";
const ADMIN_AUTH = { token: { email: "ozenenesis56@gmail.com", email_verified: true } };
const chatId = "-1001234567890";
const now = Date.now();

function configuredSource(autoPublish: boolean) {
    const config = loadTelegramListingsConfig({
        TELEGRAM_LISTINGS_IMPORT_ENABLED: "true",
        TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED: String(autoPublish),
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
            [chatId]: {
                displayName: "Synthetic test source",
                publicUsername: "xoven_test_source",
                chatType: "supergroup",
                allowedSenderIds: ["8519508488"],
                rightsReference: "https://t.me/xoven_test_source",
                rightsReviewedAt: 1_800_000_000_000,
                permissionConfirmed: true,
                autoPublish,
                maxUpdatesPerMinute: 5,
                rightsFields: ["title", "originalUrl", "description", "price", "category", "location", "publishedAt"],
                categoryMappings: { transport: { category: "sell", catalogCategory: "transport" } },
            },
        }),
    });
    assert.ok(config);
    const source = config.chats.get(chatId);
    assert.ok(source);
    return source;
}

function syntheticMessage(messageId: number, title: string) {
    return {
        message_id: messageId,
        date: Math.floor(now / 1000),
        chat: { id: Number(chatId), type: "supergroup", username: "xoven_test_source" },
        from: { id: 8519508488, is_bot: false },
        text: [
            title,
            "Достатньо докладний опис для синтетичної перевірки Telegram імпорту до каталогу.",
            "Категорія: transport",
            "Тип пропозиції: paid",
            "Ціна: 100 zł",
            "Місто: Варшава",
            "Воєводство: Мазовецьке",
        ].join("\n"),
    };
}

test("Telegram import is idempotent, stages published edits, and keeps rejected messages closed", {
    skip: !EMULATOR_HOST,
}, async () => {
    const [host, rawPort] = (EMULATOR_HOST ?? "127.0.0.1:8088").split(":");
    const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    let environment: RulesTestEnvironment | undefined;
    let app: ReturnType<typeof initializeAdminApp> | undefined;
    try {
        environment = await initializeTestEnvironment({
            projectId: PROJECT_ID,
            firestore: { host, port: Number(rawPort), rules },
        });
        await environment.clearFirestore();
        app = initializeAdminApp({ projectId: PROJECT_ID }, `telegram-ads-${Date.now()}`);
        const db = getAdminFirestore(app);
        const source = configuredSource(true);
        const initial = parseTelegramAdMessage(syntheticMessage(1001, "Продам тестовый велосипед"), source);
        const images = { urls: [] as string[], paths: [] as string[] };

        assert.equal(await ingestTelegramAd(db, initial, images, false, now), "created");
        const key = createTelegramImportKey(source.source.id, chatId, 1001);
        const adId = `telegram_${key}`;
        const initialAd = await db.collection("ads").doc(adId).get();
        assert.equal(initialAd.get("sourceType"), "telegram");
        assert.equal(initialAd.get("userId"), "telegram_import");
        assert.equal(initialAd.get("status"), "active");
        assert.equal(initialAd.get("sourceUrl"), "https://t.me/xoven_test_source/1001");
        assert.equal(await ingestTelegramAd(db, initial, images, false, now + 1), "duplicate");

        const edited = parseTelegramAdMessage(syntheticMessage(1001, "Продам отредактированный велосипед"), source);
        assert.equal(await ingestTelegramAd(db, edited, images, true, now + 2), "edited_needs_review");
        assert.equal((await db.collection("ads").doc(adId).get()).get("title"), "Продам тестовый велосипед");
        const editedRecord = await db.collection("telegramImportRecords").doc(key).get();
        assert.equal(editedRecord.get("state"), "published");
        assert.equal(editedRecord.get("pendingRevision.title"), "Продам отредактированный велосипед");

        const approved = await moderateTelegramImport(db, ADMIN_AUTH, {
            id: key,
            expectedContentHash: editedRecord.get("pendingRevisionContentHash"),
            action: "approve",
            ad: {
                title: "Продам отредактированный велосипед",
                description: edited.description,
                category: "sell",
                catalogCategory: "transport",
                city: "Варшава",
                voivodeship: "Мазовецьке",
                priceType: "paid",
                price: "100 zł",
            },
        });
        assert.deepEqual(approved, { approved: true, adId });
        assert.equal((await db.collection("ads").doc(adId).get()).get("title"), "Продам отредактированный велосипед");

        const reviewSource = configuredSource(false);
        const review = parseTelegramAdMessage(syntheticMessage(1002, "Продам тестовый стул"), reviewSource);
        assert.equal(await ingestTelegramAd(db, review, images, false, now + 3), "review");
        const reviewKey = createTelegramImportKey(reviewSource.source.id, chatId, 1002);
        const reviewRecord = await db.collection("telegramImportRecords").doc(reviewKey).get();
        const reviewResult = await moderateTelegramImport(db, ADMIN_AUTH, {
            id: reviewKey,
            expectedContentHash: reviewRecord.get("contentHash"),
            action: "reject",
            reason: "synthetic-test",
        });
        assert.deepEqual(reviewResult, { rejected: true });
        assert.equal(await ingestTelegramAd(db, review, images, false, now + 4), "sticky_terminal");
        assert.equal((await db.collection("telegramImportRecords").doc(reviewKey).get()).get("state"), "rejected");
        assert.equal((await db.collection("ads").doc(`telegram_${reviewKey}`).get()).exists, false);

        const client = environment.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(client, "telegramImportRecords", key)));
        await assertSucceeds(getDoc(doc(client, "ads", adId)));
    } finally {
        await environment?.cleanup();
        if (app) await deleteApp(app);
    }
});
