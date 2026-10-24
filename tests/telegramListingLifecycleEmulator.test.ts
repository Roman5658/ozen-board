import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deleteApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc } from "firebase/firestore";
import { deactivateTelegramListing } from "../functions/src/imports/telegramListingLifecycle";
import { normalizeExternalListing, type ExternalListingSource } from "../functions/src/imports/externalListings";
import { FirestoreExternalListingsRepository } from "../functions/src/imports/firestoreExternalListingsRepository";
import { FirestoreTelegramUpdateRateLimiter } from "../functions/src/imports/telegramUpdateRateLimiter";

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = "demo-ozen-board-stage-61";

test("manual deactivation hides only Telegram external records and stays hidden", {
    skip: !EMULATOR_HOST,
}, async () => {
    const [host, rawPort] = (EMULATOR_HOST ?? "127.0.0.1:8088").split(":");
    const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    let environment: RulesTestEnvironment | undefined;
    let app: ReturnType<typeof initializeAdminApp> | undefined;
    let adminDb: ReturnType<typeof getAdminFirestore> | undefined;
    const telegramSourceId = `telegram_${randomBytes(10).toString("hex")}`;
    const telegramAdId = `${telegramSourceId}_${randomBytes(32).toString("hex")}`;
    const reviewTelegramAdId = `${telegramSourceId}_${randomBytes(32).toString("hex")}`;
    const otherSourceAdId = `partner-source_${randomBytes(32).toString("hex")}`;
    const quotaId = `tgtest_${randomBytes(8).toString("hex")}`;
    const quotaRunId = `quota-test-${randomBytes(8).toString("hex")}`;
    const quotaDay = new Date().toISOString().slice(0, 10);
    let quotaListingIds: string[] = [];

    try {
        environment = await initializeTestEnvironment({
            projectId: PROJECT_ID,
            firestore: { host, port: Number(rawPort), rules },
        });
        app = initializeAdminApp({ projectId: PROJECT_ID }, `telegram-lifecycle-${Date.now()}`);
        adminDb = getAdminFirestore(app);
        const limiter = new FirestoreTelegramUpdateRateLimiter(adminDb);
        const rateWindowStart = Math.floor(Date.now() / 60_000) * 60_000;
        assert.equal(await limiter.allow(telegramSourceId, rateWindowStart + 1, 2), true);
        assert.equal(await limiter.allow(telegramSourceId, rateWindowStart + 2, 2), true);
        assert.equal(await limiter.allow(telegramSourceId, rateWindowStart + 3, 2), false);
        assert.equal(await limiter.allow(telegramSourceId, rateWindowStart + 60_001, 2), true);

        const quotaSource: ExternalListingSource = {
            id: telegramSourceId,
            displayName: "Synthetic Telegram quota test",
            allowedListingHosts: ["t.me"],
            allowedImageHosts: [],
            rights: {
                reference: "https://rights.example.test/telegram-test",
                reviewedAt: Date.now(),
                permissionConfirmed: true,
                fields: ["title", "originalUrl"],
            },
            categoryMappings: {},
        };
        const quotaListings = [1, 2, 3].map((number) => normalizeExternalListing({
            sourceListingId: `quota-${number}-${randomBytes(4).toString("hex")}`,
            originalUrl: `https://t.me/synthetic_test/${number}`,
            title: `Synthetic quota listing ${number}`,
        }, quotaSource, Date.now()));
        quotaListingIds = quotaListings.map((listing) => listing.id);
        const quotaRepository = new FirestoreExternalListingsRepository(adminDb, {
            quotaId,
            maxNewListingsPerUtcDay: 2,
        });
        const quotaNow = Date.now();
        assert.equal(await quotaRepository.acquireLock(telegramSourceId, quotaRunId, quotaNow, 60_000), true);
        const quotaOutcomes = [];
        for (const listing of quotaListings) {
            quotaOutcomes.push(await quotaRepository.upsertListing(listing, quotaRunId, Date.now()));
        }
        assert.deepEqual(quotaOutcomes, ["created", "created", "limited"]);
        assert.equal((await adminDb.collection("externalAds").doc(quotaListings[2].id).get()).exists, false);
        assert.equal((await adminDb.collection("externalImportDailyLimits").doc(`${quotaId}_${quotaDay}`).get()).get("count"), 2);
        await quotaRepository.releaseLock(telegramSourceId, quotaRunId);

        await adminDb.collection("externalAds").doc(telegramAdId).set({
            id: telegramAdId,
            sourceId: telegramSourceId,
            isExternal: true,
            title: "Synthetic Telegram listing",
            originalUrl: "https://t.me/example/123",
            status: "active",
        });
        await adminDb.collection("externalAds").doc(otherSourceAdId).set({
            id: otherSourceAdId,
            sourceId: "partner-source",
            isExternal: true,
            title: "Synthetic partner listing",
            originalUrl: "https://example.test/listing/1",
            status: "active",
        });
        await adminDb.collection("externalAds").doc(reviewTelegramAdId).set({
            id: reviewTelegramAdId,
            sourceId: telegramSourceId,
            isExternal: true,
            title: "Synthetic Telegram review listing",
            originalUrl: "https://t.me/example/456",
            status: "review",
        });

        assert.deepEqual(await deactivateTelegramListing(adminDb, telegramAdId, "original_removed"), { deactivated: true });
        assert.deepEqual(await deactivateTelegramListing(adminDb, telegramAdId, "original_removed"), {
            deactivated: true,
            alreadyHidden: true,
        });
        await assert.rejects(deactivateTelegramListing(adminDb, otherSourceAdId, "original_invalid"), (error: unknown) => {
            assert.equal((error as { code?: unknown }).code, "failed-precondition");
            return true;
        });
        assert.equal((await adminDb.collection("externalAds").doc(telegramAdId).get()).get("status"), "hidden");
        assert.equal((await adminDb.collection("externalAds").doc(otherSourceAdId).get()).get("status"), "active");

        const anonymous = environment.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(anonymous, "externalAds", telegramAdId)));
        await assertFails(getDoc(doc(anonymous, "externalAds", reviewTelegramAdId)));
        await assertFails(getDoc(doc(anonymous, "telegramWebhookRateLimits", telegramSourceId)));
        await assertFails(getDoc(doc(anonymous, "externalImportDailyLimits", `${quotaId}_${quotaDay}`)));
        await assertSucceeds(getDoc(doc(anonymous, "externalAds", otherSourceAdId)));
    } finally {
        if (adminDb) {
            await adminDb.collection("externalImportLocks").doc(telegramSourceId).delete().catch(() => undefined);
            await adminDb.collection("externalImportDailyLimits").doc(`${quotaId}_${quotaDay}`).delete().catch(() => undefined);
            for (const listingId of quotaListingIds) {
                await adminDb.collection("externalAds").doc(listingId).delete().catch(() => undefined);
            }
            await adminDb.collection("telegramWebhookRateLimits").doc(telegramSourceId).delete().catch(() => undefined);
            await adminDb.collection("externalAds").doc(telegramAdId).delete().catch(() => undefined);
            await adminDb.collection("externalAds").doc(reviewTelegramAdId).delete().catch(() => undefined);
            await adminDb.collection("externalAds").doc(otherSourceAdId).delete().catch(() => undefined);
        }
        await environment?.cleanup();
        if (app) await deleteApp(app);
    }
});
