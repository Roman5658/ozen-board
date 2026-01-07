import fetch from "node-fetch";
import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

// Инициализация Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

export const verifyPayPalPayment = onCall(async (request) => {
// ======================
// 1. ДАННЫЕ С ФРОНТА
// ======================
    const data = (request.data ?? {}) as {
        orderId?: string;
        targetType?: "ad" | "auction";
        targetId?: string;
        promotionType?: string;
    };

    const orderId = data.orderId;
    const targetType = data.targetType;
    const targetId = data.targetId;
    const promotionType = data.promotionType;

    if (!orderId || !targetType || !targetId || !promotionType) {
        throw new Error("Missing payment data");
    }
// ======================
// 1.1 ЗАЩИТА ОТ ПОВТОРНОЙ ОБРАБОТКИ PAYPAL ORDER
// ======================
    const existingPayment = await db
        .collection("payments")
        .where("orderId", "==", orderId)
        .limit(1)
        .get();

    if (!existingPayment.empty) {
        throw new Error("Payment already processed");
    }

// ======================
// NORMALIZE PROMOTION TYPE (FRONT → SERVER)
// ======================
    let normalizedPromotion: string = promotionType;

    if (targetType === "auction") {
        if (promotionType === "top-auction") normalizedPromotion = "top";
        if (promotionType === "highlight-gold") normalizedPromotion = "gold";
    }


    // ======================
    // 2. PAYPAL CREDENTIALS
    // ======================
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_SECRET;

    if (!clientId || !secret) {
        throw new Error("PayPal credentials not configured");
    }
// ======================
// 2.1 PAYPAL BASE URL (sandbox / live)
// ======================
    const mode = (process.env.PAYPAL_MODE || "live").toLowerCase();
    const PAYPAL_BASE =
        mode === "sandbox"
            ? "https://api-m.sandbox.paypal.com"
            : "https://api-m.paypal.com";

    // ======================
    // 3. ACCESS TOKEN
    // ======================
    const tokenRes = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {

        method: "POST",
        headers: {
            Authorization:
                "Basic " +
                Buffer.from(`${clientId}:${secret}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
    });

    const tokenData = (await tokenRes.json()) as {
        access_token?: string;
    };

    if (!tokenData.access_token) {
        throw new Error("Failed to get PayPal access token");
    }

    // ======================
    // 4. ПРОВЕРКА ЗАКАЗА
    // ======================
    const orderRes = await fetch(
        `${PAYPAL_BASE}/v2/checkout/orders/${orderId}`,
        {

            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
            },
        }
    );

    const order = (await orderRes.json()) as {
        id: string;
        status: string;
        purchase_units: {
            amount: {
                value: string;
                currency_code: string;
            };
        }[];
        payer?: {
            email_address?: string;
        };
    };

    if (order.status !== "COMPLETED" && order.status !== "APPROVED") {
        throw new Error(`Payment not completed: ${order.status}`);
    }

// ======================
// 4.1 ЦЕНЫ (SERVER SIDE)
// ======================
    const PRICE_MAP = {
        ad: {
            bump: { value: 13.0, currency: "PLN" },
            top3: { value: 19.99, currency: "PLN" },
            top6: { value: 15.0, currency: "PLN" },
            gold: { value: 7.0, currency: "PLN" },
        },
        auction: {
            top: { value: 19.0, currency: "PLN" },
            featured: { value: 12.0, currency: "PLN" },
            gold: { value: 9.0, currency: "PLN" },
        },
    } as const;
    const priceGroup =
        targetType === "ad"
            ? PRICE_MAP.ad
            : PRICE_MAP.auction;

    const expectedPrice =
        priceGroup[normalizedPromotion as keyof typeof priceGroup];



    if (!expectedPrice) {
        throw new Error("Invalid promotion type for target");
    }



    if (!order.purchase_units || !order.purchase_units.length) {
        throw new Error("Invalid PayPal order structure");
    }

    const paidAmount = Number(order.purchase_units[0].amount.value);
    const paidCurrency = order.purchase_units[0].amount.currency_code;

    if (paidCurrency !== expectedPrice.currency) {
        throw new Error("Invalid currency");
    }

    if (paidAmount !== expectedPrice.value) {
        throw new Error(
            `Invalid amount. Expected ${expectedPrice.value}, got ${paidAmount}`
        );
    }


    // ======================
    // 5. СРОК ПРОДВИЖЕНИЯ
    // ======================
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();

    let promotionUntil = now;
    let ownerUserId: string | null = null;


    if (normalizedPromotion === "gold") {
        promotionUntil += 7 * DAY;
    } else {
        promotionUntil += 3 * DAY;
    }



    // ======================
    // 6. ОБНОВЛЕНИЕ БАЗЫ
    // ======================
    if (targetType === "ad") {
        const ref = db.collection("ads").doc(targetId);
        const snap = await ref.get();

        if (!snap.exists) {
            throw new Error("Ad not found");
        }

        const ad = snap.data() as any;
        ownerUserId = ad.userId;

// ❌ GOLD уже активен
        if (
            promotionType === "gold" &&
            ad.highlightUntil &&
            ad.highlightUntil > now
        ) {
            throw new Error("Gold already active");
        }

// ❌ TOP уже активен или в очереди
        if (
            (promotionType === "top3" || promotionType === "top6") &&
            (
                (ad.pinnedUntil && ad.pinnedUntil > now) ||
                (ad.pinQueueAt && (!ad.pinnedUntil || ad.pinnedUntil <= now))
            )
        ) {
            throw new Error("Top already active or queued");
        }

        const update: any = {};

        if (promotionType === "top3" || promotionType === "top6") {
            update.pinType = promotionType;
            update.pinnedAt = now;
            update.pinnedUntil = promotionUntil;
        }

        if (promotionType === "bump") {
            update.bumpAt = now;
        }

        if (promotionType === "gold") {
            update.highlightType = "gold";
            update.highlightUntil = promotionUntil;
        }

        await ref.update(update);
    }

    if (targetType === "auction") {
        const ref = db.collection("auctions").doc(targetId);
        const snap = await ref.get();

        if (!snap.exists) {
            throw new Error("Auction not found");
        }

        const auction = snap.data() as any;
        ownerUserId = auction.ownerId;

        // ❌ если уже активна
        if (auction.promotionUntil && auction.promotionUntil > now) {
            throw new Error("Auction promotion already active");
        }

        // ❌ если уже в очереди
        if (
            auction.promotionQueueAt &&
            (!auction.promotionUntil || auction.promotionUntil <= now)
        ) {
            throw new Error("Auction already in queue");
        }

        await ref.update({
            promotionType: normalizedPromotion,
            promotionUntil,
            promotionQueueAt: null,
        });


    }

// ======================
// 4.2 LOG PAYMENT
// ======================
    await db.collection("payments").add({
        provider: "paypal",
        orderId: order.id,

        userId: ownerUserId,

        targetType,
        targetId,
        promotionType: normalizedPromotion,

        amount: paidAmount,
        currency: paidCurrency,

        payerEmail: order.payer?.email_address ?? null,

        status: "completed",
        createdAt: Date.now(),
    });

    // ======================
    // 7. ОТВЕТ
    // ======================
    return {
        ok: true,
        orderId: order.id,
        targetType,
        targetId,
        promotionType: normalizedPromotion,

        promotionUntil,
        amount: order.purchase_units[0].amount.value,
        currency: order.purchase_units[0].amount.currency_code,
        payer: order.payer?.email_address ?? null,
    };
});
