import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { listTelegramModerationItems, moderateTelegramImport } from "./telegramAds";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

/** Returns only the server-prepared Telegram review queue to verified admins. */
export const listTelegramListingsForModeration = onCall(
    { timeoutSeconds: 20, maxInstances: 3 },
    async (request) => listTelegramModerationItems(db, request.auth),
);

/** Approves or rejects one private Telegram import record using server-side validation. */
export const moderateTelegramListing = onCall(
    { timeoutSeconds: 30, maxInstances: 3 },
    async (request) => moderateTelegramImport(db, request.auth, request.data),
);
