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
    const {
        orderId,
        targetType,     // "ad" | "auction"
        targetId,       // id объявления / аукциона
        promotionType,  // тип продвижения
    } = request.data as {
        orderId?: string;
        targetType?: "ad" | "auction";
        targetId?: string;
        promotionType?: string;
    };

    if (!orderId || !targetType || !targetId || !promotionType) {
        throw new Error("Missing payment data");
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
    // 3. ACCESS TOKEN
    // ======================
    const tokenRes = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
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
        `https://api-m.paypal.com/v2/checkout/orders/${orderId}`,
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

    if (order.status !== "COMPLETED") {
        throw new Error("Payment not completed");
    }

    // ======================
    // 5. СРОК ПРОДВИЖЕНИЯ
    // ======================
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();

    let promotionUntil = now;

    if (promotionType === "gold" || promotionType === "highlight-gold") {
        promotionUntil += 7 * DAY;
    } else {
        promotionUntil += 3 * DAY;
    }

    // ======================
    // 6. ОБНОВЛЕНИЕ БАЗЫ
    // ======================
    if (targetType === "ad") {
        const ref = db.collection("ads").doc(targetId);
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

        await ref.update({
            promotionType,
            promotionUntil,
        });
    }

    // ======================
    // 7. ОТВЕТ
    // ======================
    return {
        ok: true,
        orderId: order.id,
        targetType,
        targetId,
        promotionType,
        promotionUntil,
        amount: order.purchase_units[0].amount.value,
        currency: order.purchase_units[0].amount.currency_code,
        payer: order.payer?.email_address ?? null,
    };
});
