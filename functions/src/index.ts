import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

const DAY = 24 * 60 * 60 * 1000;

/* ======================================================
   ЧАТЫ — автоудаление через 30 дней
====================================================== */
const CHAT_TTL = 30 * DAY;

export const cleanupHiddenChats = onSchedule(
    {
        schedule: "every day 03:00",
        timeZone: "Europe/Warsaw",
    },
    async () => {
        const now = Date.now();
        const chatsSnap = await db.collection("chats").get();

        for (const chatDoc of chatsSnap.docs) {
            const chat = chatDoc.data();

            const users: string[] = chat.users || [];
            const hiddenFor: string[] = chat.hiddenFor || [];
            const hiddenForAt: Record<string, number> = chat.hiddenForAt || {};

            const updatedAt =
                typeof chat.updatedAt?.toMillis === "function"
                    ? chat.updatedAt.toMillis()
                    : 0;

            // если чат скрыт не всеми — пропускаем
            if (hiddenFor.length !== users.length) continue;

            const expiredForAll = users.every(userId => {
                const hiddenAt = hiddenForAt[userId];
                if (!hiddenAt) return false;

                return now - hiddenAt > CHAT_TTL && updatedAt <= hiddenAt;
            });

            if (!expiredForAll) continue;

            // удаляем сообщения + чат
            const messagesSnap = await chatDoc.ref
                .collection("messages")
                .get();

            const batch = db.batch();
            messagesSnap.docs.forEach(m => batch.delete(m.ref));
            batch.delete(chatDoc.ref);

            await batch.commit();
            console.log(`Chat ${chatDoc.id} deleted`);
        }
    }
);

/* ======================================================
   АУКЦИОНЫ — автоудаление через 5 дней
====================================================== */
const AUCTION_TTL = 5 * DAY;

export const cleanupEndedAuctions = onSchedule(
    {
        schedule: "every day 04:00",
        timeZone: "Europe/Warsaw",
    },
    async () => {
        const now = Date.now();
        const auctionsSnap = await db.collection("auctions").get();

        for (const auctionDoc of auctionsSnap.docs) {
            const auction = auctionDoc.data();
            const endsAt =
                typeof auction.endsAt === "number" ? auction.endsAt : 0;

            if (!endsAt) continue;
            if (now < endsAt + AUCTION_TTL) continue;

            // чистка ставок
            const bidsSnap = await auctionDoc.ref
                .collection("bids")
                .get();

            const batch = db.batch();
            bidsSnap.docs.forEach(bid => batch.delete(bid.ref));
            batch.delete(auctionDoc.ref);

            await batch.commit();
            console.log(`Auction ${auctionDoc.id} deleted`);
        }
    }
);
export { verifyPayPalPayment } from "./paypal/verifyPayPalPayment";

