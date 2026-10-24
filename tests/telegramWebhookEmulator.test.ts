import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deleteApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { FirestoreTelegramUpdateLedger } from "../functions/src/imports/telegramUpdateLedger";

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = "demo-ozen-board-stage-61";

test("Telegram update ledger is transactional, retryable, and client-inaccessible", {
    skip: !EMULATOR_HOST,
}, async () => {
    const [host, rawPort] = (EMULATOR_HOST ?? "127.0.0.1:8088").split(":");
    const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    let environment: RulesTestEnvironment | undefined;
    let app: ReturnType<typeof initializeAdminApp> | undefined;
    const updateId = Math.floor(Date.now() / 10);

    try {
        environment = await initializeTestEnvironment({
            projectId: PROJECT_ID,
            firestore: { host, port: Number(rawPort), rules },
        });
        app = initializeAdminApp({ projectId: PROJECT_ID }, `telegram-ledger-${Date.now()}`);
        const db = getAdminFirestore(app);
        const ledger = new FirestoreTelegramUpdateLedger(db);

        assert.equal(await ledger.claim(updateId, Date.now(), "first-attempt"), "claimed");
        assert.equal(await ledger.claim(updateId, Date.now(), "concurrent-attempt"), "busy");
        assert.equal(await ledger.finish(updateId, "wrong-owner", Date.now()), false);
        assert.equal(await ledger.finish(updateId, "first-attempt", Date.now()), true);
        assert.equal(await ledger.claim(updateId, Date.now(), "telegram-retry"), "processed");

        const marker = await db.collection("telegramWebhookUpdates").doc(String(updateId)).get();
        assert.equal(marker.get("status"), "processed");
        assert.equal(typeof marker.get("expireAt")?.toMillis, "function");

        const client = environment.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(client, "telegramWebhookUpdates", String(updateId))));
        await assertFails(setDoc(doc(client, "telegramWebhookUpdates", "client-forged"), { status: "processed" }));
        await db.collection("telegramWebhookUpdates").doc(String(updateId)).delete();
    } finally {
        await environment?.cleanup();
        if (app) await deleteApp(app);
    }
});
