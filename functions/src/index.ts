import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp();
}

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

/* ======================================================
   ADS — автоматическая ротация PIN (TOP3 / TOP6)
====================================================== */

const TOP3_LIMIT = 3;
const TOP6_LIMIT = 6;

const TOP3_DURATION = 3 * DAY;
const TOP6_DURATION = 3 * DAY;

export const rotatePinnedAds = onSchedule(
    {
        schedule: "every 5 minutes",
        timeZone: "Europe/Warsaw",
    },
    async () => {
        const now = Date.now();

        const adsSnap = await db
            .collection("ads")
            .where("status", "==", "active")
            .get();

        // группируем по городам
        const byCity = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();

        adsSnap.docs.forEach(doc => {
            const city = doc.data().city;
            if (!city) return;

            if (!byCity.has(city)) {
                byCity.set(city, []);
            }
            byCity.get(city)!.push(doc);
        });

        for (const [city, ads] of byCity.entries()) {
            // 1️⃣ Очистка истёкших PIN (не в очереди)
            const expiredPinned = ads.filter(ad => {
                const d = ad.data();
                return (
                    d.pinType &&
                    d.pinnedUntil &&
                    d.pinnedUntil <= now &&
                    !d.pinQueueAt
                );
            });

            if (expiredPinned.length > 0) {
                const cleanupBatch = db.batch();

                expiredPinned.forEach(ad => {
                    cleanupBatch.update(ad.ref, {
                        pinType: null,
                        pinnedAt: null,
                        pinnedUntil: null,
                    });
                });

                await cleanupBatch.commit();
                console.log(`Expired PIN cleaned for city: ${city}`);
            }

            const activeTop3 = ads.filter(ad => {

                const d = ad.data();
                return (
                    d.pinType === "top3" &&
                    d.pinnedUntil &&
                    d.pinnedUntil > now
                );
            });

            const activeTop6 = ads.filter(ad => {

                const d = ad.data();
                return (
                    d.pinType === "top6" &&
                    d.pinnedUntil &&
                    d.pinnedUntil > now
                );
            });

            const freeTop3 = TOP3_LIMIT - activeTop3.length;
            const freeTop6 = TOP6_LIMIT - activeTop6.length;

            if (freeTop3 <= 0 && freeTop6 <= 0) continue;

            const queueTop3 = ads
                .filter(ad => {
                    const d = ad.data();
                    return (
                        d.pinType === "top3" &&
                        d.pinQueueAt &&
                        (!d.pinnedUntil || d.pinnedUntil <= now)
                    );
                })
                .sort((a, b) => a.data().pinQueueAt - b.data().pinQueueAt);

            const queueTop6 = ads
                .filter(ad => {
                    const d = ad.data();
                    return (
                        d.pinType === "top6" &&
                        d.pinQueueAt &&
                        (!d.pinnedUntil || d.pinnedUntil <= now)
                    );
                })
                .sort((a, b) => a.data().pinQueueAt - b.data().pinQueueAt);

            let updatesCount = 0;
            const batch = db.batch();

            queueTop3.slice(0, freeTop3).forEach(ad => {
                batch.update(ad.ref, {
                    pinnedAt: now,
                    pinnedUntil: now + TOP3_DURATION,
                    pinQueueAt: null,
                });
                updatesCount++;
            });

            queueTop6.slice(0, freeTop6).forEach(ad => {
                batch.update(ad.ref, {
                    pinnedAt: now,
                    pinnedUntil: now + TOP6_DURATION,
                    pinQueueAt: null,
                });
                updatesCount++;
            });

            if (updatesCount === 0) continue;

            await batch.commit();
            console.log(`PIN rotation executed for city: ${city}`);

        }
    }
);
/* ======================================================
   AUCTIONS — автоматическая ротация TOP / FEATURED
====================================================== */

const AUCTION_TOP_LIMIT = 3;
const AUCTION_FEATURED_LIMIT = 6;

const AUCTION_TOP_DURATION = 3 * DAY;
const AUCTION_FEATURED_DURATION = 3 * DAY;

export const rotateAuctionPromotions = onSchedule(
    {
        schedule: "every 5 minutes",
        timeZone: "Europe/Warsaw",
    },
    async () => {
        const now = Date.now();

        const snap = await db
            .collection("auctions")
            .where("status", "==", "active")
            .get();

        // группируем по voivodeship + city
        const byLocation = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();

        snap.docs.forEach(doc => {
            const d = doc.data();
            if (!d.city || !d.voivodeship) return;

            const key = `${d.voivodeship}__${d.city}`;
            if (!byLocation.has(key)) byLocation.set(key, []);
            byLocation.get(key)!.push(doc);
        });

        for (const [locationKey, auctions] of byLocation.entries()) {

            const activeTop = auctions.filter(a => {
                const d = a.data();
                return (
                    d.promotionType === "top-auction" &&
                    d.promotionUntil &&
                    d.promotionUntil > now
                );
            });

            const activeFeatured = auctions.filter(a => {
                const d = a.data();
                return (
                    d.promotionType === "featured" &&
                    d.promotionUntil &&
                    d.promotionUntil > now
                );
            });

            const freeTop = AUCTION_TOP_LIMIT - activeTop.length;
            const freeFeatured = AUCTION_FEATURED_LIMIT - activeFeatured.length;

            if (freeTop <= 0 && freeFeatured <= 0) continue;

            const queueTop = auctions
                .filter(a => {
                    const d = a.data();
                    return (
                        d.promotionType === "top-auction" &&
                        d.promotionQueueAt &&
                        (!d.promotionUntil || d.promotionUntil <= now)
                    );
                })
                .sort((a, b) => a.data().promotionQueueAt - b.data().promotionQueueAt);

            const queueFeatured = auctions
                .filter(a => {
                    const d = a.data();
                    return (
                        d.promotionType === "featured" &&
                        d.promotionQueueAt &&
                        (!d.promotionUntil || d.promotionUntil <= now)
                    );
                })
                .sort((a, b) => a.data().promotionQueueAt - b.data().promotionQueueAt);

            let updates = 0;
            const batch = db.batch();

            queueTop.slice(0, freeTop).forEach(doc => {
                batch.update(doc.ref, {
                    promotionUntil: now + AUCTION_TOP_DURATION,
                    promotionQueueAt: null,
                });
                updates++;
            });

            queueFeatured.slice(0, freeFeatured).forEach(doc => {
                batch.update(doc.ref, {
                    promotionUntil: now + AUCTION_FEATURED_DURATION,
                    promotionQueueAt: null,
                });
                updates++;
            });

            if (updates === 0) continue;

            await batch.commit();
            console.log(`Auction promotion rotation executed for ${locationKey}`);
        }
    }
);
