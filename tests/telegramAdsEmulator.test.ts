import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deleteApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc } from "firebase/firestore";
import { ingestTelegramAd, inspectTelegramImport, moderateTelegramImport, createTelegramImportKey } from "../functions/src/imports/telegramAds";
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
                rightsFields: ["title", "originalUrl", "description", "price", "category", "location", "images", "publishedAt"],
                categoryMappings: { transport: { category: "sell", catalogCategory: "transport" } },
            },
        }),
    });
    assert.ok(config);
    const source = config.chats.get(chatId);
    assert.ok(source);
    return source;
}

function syntheticMessage(messageId: number, title: string, photoFileId?: string) {
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
        ...(photoFileId ? { photo: [{ file_id: photoFileId }] } : {}),
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
        const initial = parseTelegramAdMessage(syntheticMessage(1001, "Продам тестовый велосипед", "initial-photo"), source);
        const key = createTelegramImportKey(source.source.id, chatId, 1001);
        const initialImagePath = `telegram-imports/${key}/${initial.contentHash}/0.jpg`;
        const images = { urls: ["https://storage.example.test/initial"], paths: [initialImagePath] };

        assert.equal(await ingestTelegramAd(db, initial, images, false, now), "created");
        const adId = `telegram_${key}`;
        const initialAd = await db.collection("ads").doc(adId).get();
        assert.equal(initialAd.get("sourceType"), "telegram");
        assert.equal(initialAd.get("userId"), "telegram_import");
        assert.equal(initialAd.get("status"), "active");
        assert.equal(initialAd.get("sourceUrl"), "https://t.me/xoven_test_source/1001");
        assert.equal(await ingestTelegramAd(db, initial, images, false, now + 1), "duplicate");

        const telethonCopy = parseTelegramAdMessage(
            syntheticMessage(1001, "Продам тестовый велосипед", "collector:synthetic-image-hash"),
            source,
        );
        assert.notEqual(telethonCopy.contentHash, initial.contentHash, "transport photo IDs differ even for the same post");
        assert.equal(await inspectTelegramImport(db, telethonCopy, false), "duplicate");
        const unreferencedTransportImage = `telegram-imports/${key}/${telethonCopy.contentHash}/0.jpg`;
        const cleanedDuplicateImages: string[] = [];
        assert.equal(await ingestTelegramAd(
            db,
            telethonCopy,
            { urls: ["https://storage.example.test/duplicate"], paths: [unreferencedTransportImage] },
            false,
            now + 1,
            { deletePhotos: async (paths) => { cleanedDuplicateImages.push(...paths); } },
        ), "duplicate");
        assert.deepEqual(cleanedDuplicateImages, [unreferencedTransportImage]);
        assert.equal((await db.collection("telegramImportRecords").doc(key).get()).get("pendingRevision"), undefined);

        const repost = parseTelegramAdMessage(syntheticMessage(1006, "Продам тестовый велосипед"), source);
        assert.equal(repost.contentHash === initial.contentHash, false, "message URL makes parser hashes message-specific");
        assert.equal(await ingestTelegramAd(db, repost, { urls: [], paths: [] }, false, now + 1), "review");
        const repostKey = createTelegramImportKey(source.source.id, chatId, 1006);
        const repostRecord = await db.collection("telegramImportRecords").doc(repostKey).get();
        assert.ok(repostRecord.get("reviewReasons").includes("possible_duplicate"));
        assert.equal((await db.collection("ads").doc(`telegram_${repostKey}`).get()).exists, false);

        const crossSourceMessage = syntheticMessage(1007, "Продам тестовый велосипед");
        crossSourceMessage.chat = { id: -1001234567891, type: "supergroup", username: "another_test_source" };
        crossSourceMessage.text = syntheticMessage(1001, "Продам тестовый велосипед").text;
        const secondSource = loadTelegramListingsConfig({
            TELEGRAM_LISTINGS_IMPORT_ENABLED: "true",
            TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED: "true",
            TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
                "-1001234567891": {
                    displayName: "Synthetic second source",
                    publicUsername: "another_test_source",
                    chatType: "supergroup",
                    allowedSenderIds: ["8519508488"],
                    rightsReference: "https://t.me/another_test_source",
                    rightsReviewedAt: 1_800_000_000_000,
                    permissionConfirmed: true,
                    autoPublish: true,
                    maxUpdatesPerMinute: 5,
                    rightsFields: ["title", "originalUrl", "description", "price", "category", "location", "images", "publishedAt"],
                    categoryMappings: { transport: { category: "sell", catalogCategory: "transport" } },
                },
            }),
        });
        assert.ok(secondSource);
        const secondSourceParsed = parseTelegramAdMessage(crossSourceMessage, secondSource.chats.get("-1001234567891"));
        assert.equal(initial.title, secondSourceParsed.title);
        assert.equal(initial.description, secondSourceParsed.description);
        assert.equal(await ingestTelegramAd(db, secondSourceParsed, { urls: [], paths: [] }, false, now + 2), "review");
        const secondSourceKey = createTelegramImportKey(secondSourceParsed.sourceId, secondSourceParsed.chatId, 1007);
        const secondSourceRecord = await db.collection("telegramImportRecords").doc(secondSourceKey).get();
        assert.ok(secondSourceRecord.get("reviewReasons").includes("possible_duplicate"));
        assert.equal((await db.collection("ads").doc(`telegram_${secondSourceKey}`).get()).exists, false);

        const concurrentA = parseTelegramAdMessage(syntheticMessage(1010, "Продам тестовый детский шлем"), source);
        const concurrentB = parseTelegramAdMessage(syntheticMessage(1011, "Продам тестовый детский шлем"), source);
        const concurrentResults = await Promise.all([
            ingestTelegramAd(db, concurrentA, { urls: [], paths: [] }, false, now + 3),
            ingestTelegramAd(db, concurrentB, { urls: [], paths: [] }, false, now + 3),
        ]);
        assert.equal(concurrentResults.filter((result) => result === "created").length, 1);
        assert.equal(concurrentResults.filter((result) => result === "review").length, 1);

        const noAmountMessage = syntheticMessage(1004, "Продам тестовый велосипед без суммы");
        noAmountMessage.text = noAmountMessage.text.replace("Ціна: 100 zł\n", "");
        const noAmount = parseTelegramAdMessage(noAmountMessage, source);
        assert.equal(noAmount.priceType, "paid");
        assert.equal(noAmount.price, undefined);
        assert.equal(await ingestTelegramAd(db, noAmount, { urls: [], paths: [] }, false, now + 1), "created");
        const noAmountKey = createTelegramImportKey(source.source.id, chatId, 1004);
        const noAmountAd = await db.collection("ads").doc(`telegram_${noAmountKey}`).get();
        assert.equal(noAmountAd.get("priceType"), "paid");
        assert.equal(noAmountAd.get("price"), "");

        const edited = parseTelegramAdMessage(syntheticMessage(1001, "Продам отредактированный велосипед", "edited-photo"), source);
        const editedImagePath = `telegram-imports/${key}/${edited.contentHash}/0.jpg`;
        const editedImages = { urls: ["https://storage.example.test/edited"], paths: [editedImagePath] };
        assert.equal(await ingestTelegramAd(db, edited, editedImages, true, now + 2), "edited_needs_review");
        assert.equal((await db.collection("ads").doc(adId).get()).get("title"), "Продам тестовый велосипед");
        const editedRecord = await db.collection("telegramImportRecords").doc(key).get();
        assert.equal(editedRecord.get("state"), "published");
        assert.equal(editedRecord.get("pendingRevision.title"), "Продам отредактированный велосипед");

        const deletedImagePaths: string[] = [];
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
        }, { deletePhotos: async (paths) => { deletedImagePaths.push(...paths); } });
        assert.deepEqual(approved, { approved: true, adId });
        assert.equal((await db.collection("ads").doc(adId).get()).get("title"), "Продам отредактированный велосипед");
        assert.deepEqual(deletedImagePaths, [initialImagePath]);
        await assert.rejects(moderateTelegramImport(db, ADMIN_AUTH, {
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
        }), { code: "failed-precondition" });

        const rejectedEdit = parseTelegramAdMessage(syntheticMessage(1001, "Велосипед с нежелательным изменением", "rejected-edit-photo"), source);
        const rejectedEditImagePath = `telegram-imports/${key}/${rejectedEdit.contentHash}/0.jpg`;
        const rejectedEditRecord = await db.collection("telegramImportRecords").doc(key).get();
        assert.equal(await ingestTelegramAd(db, rejectedEdit, {
            urls: ["https://storage.example.test/rejected-edit"],
            paths: [rejectedEditImagePath],
        }, true, now + 3), "edited_needs_review");
        const pendingRejectedEdit = await db.collection("telegramImportRecords").doc(key).get();
        const rejectEditResult = await moderateTelegramImport(db, ADMIN_AUTH, {
            id: key,
            expectedContentHash: pendingRejectedEdit.get("pendingRevisionContentHash"),
            action: "reject",
        }, { deletePhotos: async (paths) => { deletedImagePaths.push(...paths); } });
        assert.deepEqual(rejectEditResult, { rejectedEdit: true });
        assert.equal((await db.collection("ads").doc(adId).get()).get("title"), "Продам отредактированный велосипед");
        assert.deepEqual(deletedImagePaths, [initialImagePath, rejectedEditImagePath]);
        assert.equal(rejectedEditRecord.get("state"), "published");

        const reviewSource = configuredSource(false);
        const review = parseTelegramAdMessage(syntheticMessage(1002, "Продам тестовый стул"), reviewSource);
        assert.equal(await ingestTelegramAd(db, review, images, false, now + 3), "review");
        const reviewKey = createTelegramImportKey(reviewSource.source.id, chatId, 1002);
        const reviewRecord = await db.collection("telegramImportRecords").doc(reviewKey).get();
        await db.collection("telegramImportRecords").doc(reviewKey).update({
            rightsFields: ["title", "originalUrl", "description", "category", "location"],
        });
        await assert.rejects(moderateTelegramImport(db, ADMIN_AUTH, {
            id: reviewKey,
            expectedContentHash: reviewRecord.get("contentHash"),
            action: "approve",
            ad: {
                title: review.title,
                description: review.description,
                category: "sell",
                catalogCategory: "transport",
                city: "Варшава",
                voivodeship: "Мазовецьке",
                priceType: "paid",
                price: "100 zł",
            },
        }), { code: "failed-precondition" });
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

        const quotaDay = new Date(now).toISOString().slice(0, 10);
        await db.collection("externalImportDailyLimits").doc(`telegram_${quotaDay}`).set({ day: quotaDay, count: 20 });
        const limited = parseTelegramAdMessage(syntheticMessage(1003, "Продам тестовый стіл"), reviewSource);
        assert.equal(await ingestTelegramAd(db, limited, images, false, now + 5), "daily_limit");
        const limitedKey = createTelegramImportKey(reviewSource.source.id, chatId, 1003);
        assert.equal((await db.collection("telegramImportRecords").doc(limitedKey).get()).exists, false);
        assert.equal((await db.collection("ads").doc(`telegram_${limitedKey}`).get()).exists, false);

        const client = environment.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(client, "telegramImportRecords", key)));
        await assertSucceeds(getDoc(doc(client, "ads", adId)));
    } finally {
        await environment?.cleanup();
        if (app) await deleteApp(app);
    }
});
