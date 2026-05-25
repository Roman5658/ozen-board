import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

const CURRENCY = "PLN";
const DAY = 24 * 60 * 60 * 1000;

const PRICE_MAP = {
    ad: {
        bump: "7.00",
        top3: "14.99",
        top6: "9.99",
        gold: "5.00",
    },
    auction: {
        top: "14.99",
        featured: "8.00",
        gold: "5.00",
    },
} as const;

const AD_TOP_LIMITS = {
    top3: 3,
    top6: 6,
} as const;

const AUCTION_PROMOTION_LIMITS = {
    "top-auction": 3,
    featured: 6,
} as const;

type TargetType = "ad" | "auction";
type AdPromotion = "bump" | "top3" | "top6" | "gold";
type AuctionPromotion = "top-auction" | "featured" | "highlight-gold";
type StoragePromotion = AdPromotion | AuctionPromotion;

type NormalizedPayment = {
    targetType: TargetType;
    storagePromotion: StoragePromotion;
    priceAmount: string;
};

type PayPalAmount = {
    value?: string;
    currency_code?: string;
};

type PayPalCapture = {
    id?: string;
    status?: string;
    amount?: PayPalAmount;
};

type PayPalOrder = {
    id?: string;
    status?: string;
    purchase_units?: {
        amount?: PayPalAmount;
        payments?: {
            captures?: PayPalCapture[];
        };
    }[];
    payer?: {
        email_address?: string;
    };
};

type PromotionResult = {
    ownerUserId: string | null;
    promotionUntil: number | null;
    queued: boolean;
};

export const verifyPayPalPayment = onCall(async (request) => {
    const data = (request.data ?? {}) as {
        orderId?: string;
        targetType?: TargetType;
        targetId?: string;
        promotionType?: string;
    };

    const orderId = requireString(data.orderId, "orderId");
    const targetType = requireTargetType(data.targetType);
    const targetId = optionalString(data.targetId);
    const normalized = normalizePayment(targetType, data.promotionType);
    const paymentRef = db.collection("payments").doc(orderId);

    const existingPayment = await paymentRef.get();
    if (existingPayment.exists) {
        return await handleExistingPayment(
            paymentRef,
            existingPayment.data() ?? {},
            orderId,
            targetType,
            targetId,
            normalized
        );
    }

    const legacyPaymentSnap = await db.collection("payments")
        .where("orderId", "==", orderId)
        .limit(1)
        .get();
    if (!legacyPaymentSnap.empty) {
        const legacyPayment = legacyPaymentSnap.docs[0];
        return await handleExistingPayment(
            legacyPayment.ref,
            legacyPayment.data(),
            orderId,
            targetType,
            targetId,
            normalized
        );
    }

    if (targetId) {
        await assertTargetCanBePromoted(targetType, targetId, normalized.storagePromotion);
    }

    const paypalBase = getPayPalBaseUrl();
    const accessToken = await getPayPalAccessToken(paypalBase);

    const order = await getPayPalOrder(paypalBase, accessToken, orderId);
    if (order.status !== "APPROVED" && order.status !== "COMPLETED") {
        throw new Error(`PayPal order must be APPROVED before backend capture: ${order.status ?? "unknown"}`);
    }

    assertPayPalAmount(getOrderAmount(order), normalized.priceAmount);

    const capturedOrder = order.status === "COMPLETED"
        ? order
        : await capturePayPalOrder(paypalBase, accessToken, orderId);
    if (capturedOrder.status !== "COMPLETED") {
        throw new Error(`Payment not completed after backend capture: ${capturedOrder.status ?? "unknown"}`);
    }

    const completedCapture = getCompletedCapture(capturedOrder);
    const paidAmount = completedCapture?.amount ?? getOrderAmount(capturedOrder) ?? getOrderAmount(order);
    assertPayPalAmount(paidAmount, normalized.priceAmount);

    if (!targetId) {
        await db.runTransaction(async (transaction) => {
            const existingPaymentInTransaction = await transaction.get(paymentRef);
            if (existingPaymentInTransaction.exists) {
                throw new Error("Payment already processed");
            }

            transaction.create(paymentRef, {
                provider: "paypal",
                orderId: capturedOrder.id ?? orderId,
                captureId: completedCapture?.id ?? null,

                userId: null,

                targetType,
                targetId: null,
                promotionType: normalized.storagePromotion,

                amount: paidAmount?.value ?? normalized.priceAmount,
                currency: paidAmount?.currency_code ?? CURRENCY,

                payerEmail: capturedOrder.payer?.email_address ?? order.payer?.email_address ?? null,

                status: "completed",
                promotionUntil: null,
                queued: false,
                capturedAt: Date.now(),
                createdAt: Date.now(),
            });
        });

        return {
            ok: true,
            orderId: capturedOrder.id ?? orderId,
            targetType,
            targetId: null,
            promotionType: normalized.storagePromotion,
            promotionUntil: null,
            queued: false,
            amount: paidAmount?.value ?? normalized.priceAmount,
            currency: paidAmount?.currency_code ?? CURRENCY,
            payer: capturedOrder.payer?.email_address ?? order.payer?.email_address ?? null,
        };
    }

    const promotionResult = await db.runTransaction(async (transaction): Promise<PromotionResult> => {
        const existingPayment = await transaction.get(paymentRef);
        if (existingPayment.exists) {
            throw new Error("Payment already processed");
        }

        const result = await applyPromotion(transaction, targetType, targetId, normalized);

        transaction.create(paymentRef, {
            provider: "paypal",
            orderId: capturedOrder.id ?? orderId,
            captureId: completedCapture?.id ?? null,

            userId: result.ownerUserId,

            targetType,
            targetId,
            promotionType: normalized.storagePromotion,

            amount: paidAmount?.value ?? normalized.priceAmount,
            currency: paidAmount?.currency_code ?? CURRENCY,

            payerEmail: capturedOrder.payer?.email_address ?? order.payer?.email_address ?? null,

            status: "completed",
            promotionUntil: result.promotionUntil,
            queued: result.queued,
            createdAt: Date.now(),
        });
        return result;
    });

    return {
        ok: true,
        orderId: capturedOrder.id ?? orderId,
        targetType,
        targetId,
        promotionType: normalized.storagePromotion,
        promotionUntil: promotionResult.promotionUntil,
        queued: promotionResult.queued,
        amount: paidAmount?.value ?? normalized.priceAmount,
        currency: paidAmount?.currency_code ?? CURRENCY,
        payer: capturedOrder.payer?.email_address ?? order.payer?.email_address ?? null,
    };
});

function requireString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Missing ${fieldName}`);
    }

    return value.trim();
}

function optionalString(value: unknown): string | null {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }

    throw new Error("Missing targetId");
}

function requireTargetType(value: unknown): TargetType {
    if (value !== "ad" && value !== "auction") {
        throw new Error("Invalid target type");
    }

    return value;
}

function normalizePayment(targetType: TargetType, promotionType: unknown): NormalizedPayment {
    const rawPromotion = requireString(promotionType, "promotionType");

    if (targetType === "ad") {
        if (rawPromotion === "bump" || rawPromotion === "top3" || rawPromotion === "top6") {
            return {
                targetType,
                storagePromotion: rawPromotion,
                priceAmount: PRICE_MAP.ad[rawPromotion],
            };
        }

        if (rawPromotion === "gold" || rawPromotion === "highlight-gold") {
            return {
                targetType,
                storagePromotion: "gold",
                priceAmount: PRICE_MAP.ad.gold,
            };
        }
    }

    if (targetType === "auction") {
        if (rawPromotion === "top" || rawPromotion === "top-auction") {
            return {
                targetType,
                storagePromotion: "top-auction",
                priceAmount: PRICE_MAP.auction.top,
            };
        }

        if (rawPromotion === "featured") {
            return {
                targetType,
                storagePromotion: "featured",
                priceAmount: PRICE_MAP.auction.featured,
            };
        }

        if (rawPromotion === "gold" || rawPromotion === "highlight-gold") {
            return {
                targetType,
                storagePromotion: "highlight-gold",
                priceAmount: PRICE_MAP.auction.gold,
            };
        }
    }

    throw new Error("Invalid promotion type for target");
}

async function handleExistingPayment(
    paymentRef: FirebaseFirestore.DocumentReference,
    payment: FirebaseFirestore.DocumentData,
    orderId: string,
    targetType: TargetType,
    targetId: string | null,
    normalized: NormalizedPayment
) {
    assertExistingPaymentMatches(payment, orderId, targetType, normalized);

    const existingTargetId = typeof payment.targetId === "string" && payment.targetId.trim()
        ? payment.targetId.trim()
        : null;

    if (!targetId || existingTargetId) {
        if (targetId && existingTargetId !== targetId) {
            throw new Error("Payment is already attached to another target");
        }

        return paymentResponse(orderId, targetType, existingTargetId, normalized, payment);
    }

    const promotionResult = await db.runTransaction(async (transaction): Promise<PromotionResult> => {
        const currentPaymentSnap = await transaction.get(paymentRef);
        if (!currentPaymentSnap.exists) {
            throw new Error("Payment not found");
        }

        const currentPayment = currentPaymentSnap.data() ?? {};
        assertExistingPaymentMatches(currentPayment, orderId, targetType, normalized);

        const currentTargetId = typeof currentPayment.targetId === "string" && currentPayment.targetId.trim()
            ? currentPayment.targetId.trim()
            : null;

        if (currentTargetId) {
            if (currentTargetId !== targetId) {
                throw new Error("Payment is already attached to another target");
            }

            return {
                ownerUserId: typeof currentPayment.userId === "string" ? currentPayment.userId : null,
                promotionUntil: typeof currentPayment.promotionUntil === "number"
                    ? currentPayment.promotionUntil
                    : null,
                queued: currentPayment.queued === true,
            };
        }

        const result = await applyPromotion(transaction, targetType, targetId, normalized);

        transaction.update(paymentRef, {
            targetId,
            userId: result.ownerUserId,
            promotionUntil: result.promotionUntil,
            queued: result.queued,
            attachedAt: Date.now(),
        });

        return result;
    });

    return {
        ok: true,
        orderId,
        targetType,
        targetId,
        promotionType: normalized.storagePromotion,
        promotionUntil: promotionResult.promotionUntil,
        queued: promotionResult.queued,
        amount: payment.amount ?? normalized.priceAmount,
        currency: payment.currency ?? CURRENCY,
        payer: payment.payerEmail ?? null,
    };
}

function assertExistingPaymentMatches(
    payment: FirebaseFirestore.DocumentData,
    orderId: string,
    targetType: TargetType,
    normalized: NormalizedPayment
): void {
    if (payment.provider !== "paypal" || payment.status !== "completed") {
        throw new Error("Payment is not completed");
    }

    if (payment.orderId && payment.orderId !== orderId) {
        throw new Error("Payment order mismatch");
    }

    if (payment.targetType !== targetType) {
        throw new Error("Payment target type mismatch");
    }

    if (payment.promotionType !== normalized.storagePromotion) {
        throw new Error("Payment promotion mismatch");
    }

    assertPayPalAmount(
        {
            value: typeof payment.amount === "string" ? payment.amount : normalized.priceAmount,
            currency_code: typeof payment.currency === "string" ? payment.currency : CURRENCY,
        },
        normalized.priceAmount
    );
}

function paymentResponse(
    orderId: string,
    targetType: TargetType,
    targetId: string | null,
    normalized: NormalizedPayment,
    payment: FirebaseFirestore.DocumentData
) {
    return {
        ok: true,
        orderId,
        targetType,
        targetId,
        promotionType: normalized.storagePromotion,
        promotionUntil: typeof payment.promotionUntil === "number" ? payment.promotionUntil : null,
        queued: payment.queued === true,
        amount: payment.amount ?? normalized.priceAmount,
        currency: payment.currency ?? CURRENCY,
        payer: payment.payerEmail ?? null,
    };
}

async function assertTargetCanBePromoted(
    targetType: TargetType,
    targetId: string,
    promotion: StoragePromotion
): Promise<void> {
    const targetRef = db.collection(targetType === "ad" ? "ads" : "auctions").doc(targetId);
    const targetSnap = await targetRef.get();

    if (!targetSnap.exists) {
        throw new Error(targetType === "ad" ? "Ad not found" : "Auction not found");
    }

    assertPromotionState(targetType, targetSnap.data() ?? {}, promotion, Date.now());
}

function assertPromotionState(
    targetType: TargetType,
    target: FirebaseFirestore.DocumentData,
    promotion: StoragePromotion,
    now: number
): void {
    if (target.status && target.status !== "active" && target.status !== "pending_payment") {
        throw new Error("Target is not active");
    }

    if (targetType === "ad") {
        if (
            promotion === "gold" &&
            typeof target.highlightUntil === "number" &&
            target.highlightUntil > now
        ) {
            throw new Error("Gold already active");
        }

        if (
            (promotion === "top3" || promotion === "top6") &&
            (
                (typeof target.pinnedUntil === "number" && target.pinnedUntil > now) ||
                (target.pinQueueAt && (!target.pinnedUntil || target.pinnedUntil <= now))
            )
        ) {
            throw new Error("Top already active or queued");
        }

        return;
    }

    if (typeof target.endsAt === "number" && target.endsAt <= now) {
        throw new Error("Auction is ended");
    }

    if (typeof target.promotionUntil === "number" && target.promotionUntil > now) {
        throw new Error("Auction promotion already active");
    }

    if (target.promotionQueueAt && (!target.promotionUntil || target.promotionUntil <= now)) {
        throw new Error("Auction already in queue");
    }
}

function getPayPalBaseUrl(): string {
    const mode = (process.env.PAYPAL_MODE || "live").toLowerCase();
    return mode === "sandbox"
        ? "https://api-m.sandbox.paypal.com"
        : "https://api-m.paypal.com";
}

async function getPayPalAccessToken(paypalBase: string): Promise<string> {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_SECRET;

    if (!clientId || !secret) {
        throw new Error("PayPal credentials not configured");
    }

    const tokenRes = await fetch(`${paypalBase}/v1/oauth2/token`, {
        method: "POST",
        headers: {
            Authorization: "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
    });

    if (!tokenRes.ok) {
        const tokenError = await tokenRes.text();
        console.error("Failed to get PayPal access token:", tokenError);
        throw new Error("Failed to get PayPal access token");
    }

    const tokenData = await tokenRes.json() as { access_token?: string };
    if (!tokenData.access_token) {
        throw new Error("Failed to get PayPal access token");
    }

    return tokenData.access_token;
}

async function getPayPalOrder(
    paypalBase: string,
    accessToken: string,
    orderId: string
): Promise<PayPalOrder> {
    const orderRes = await fetch(`${paypalBase}/v2/checkout/orders/${orderId}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!orderRes.ok) {
        const orderError = await orderRes.text();
        console.error("Failed to get PayPal order:", orderError);
        throw new Error("Failed to get PayPal order");
    }

    return await orderRes.json() as PayPalOrder;
}

async function capturePayPalOrder(
    paypalBase: string,
    accessToken: string,
    orderId: string
): Promise<PayPalOrder> {
    const captureRes = await fetch(`${paypalBase}/v2/checkout/orders/${orderId}/capture`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "PayPal-Request-Id": orderId,
        },
    });

    if (!captureRes.ok) {
        const captureError = await captureRes.text();
        console.error("PayPal capture failed:", captureError);
        throw new Error("PayPal capture failed");
    }

    return await captureRes.json() as PayPalOrder;
}

function getOrderAmount(order: PayPalOrder): PayPalAmount | null {
    return order.purchase_units?.[0]?.amount ?? null;
}

function getCompletedCapture(order: PayPalOrder): PayPalCapture | null {
    for (const unit of order.purchase_units ?? []) {
        for (const capture of unit.payments?.captures ?? []) {
            if (capture.status === "COMPLETED") {
                return capture;
            }
        }
    }

    return null;
}

function assertPayPalAmount(amount: PayPalAmount | null | undefined, expectedAmount: string): void {
    if (!amount?.value || !amount.currency_code) {
        throw new Error("Invalid PayPal order amount");
    }

    if (amount.currency_code !== CURRENCY) {
        throw new Error("Invalid currency");
    }

    if (amountToCents(amount.value) !== amountToCents(expectedAmount)) {
        throw new Error(`Invalid amount. Expected ${expectedAmount}, got ${amount.value}`);
    }
}

function amountToCents(value: string): number {
    const trimmed = value.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
        throw new Error(`Invalid amount format: ${value}`);
    }

    const [whole, fraction = ""] = trimmed.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

async function applyPromotion(
    transaction: FirebaseFirestore.Transaction,
    targetType: TargetType,
    targetId: string,
    payment: NormalizedPayment
): Promise<PromotionResult> {
    if (targetType === "ad") {
        return await applyAdPromotion(transaction, targetId, payment.storagePromotion as AdPromotion);
    }

    return await applyAuctionPromotion(transaction, targetId, payment.storagePromotion as AuctionPromotion);
}

async function applyAdPromotion(
    transaction: FirebaseFirestore.Transaction,
    adId: string,
    promotion: AdPromotion
): Promise<PromotionResult> {
    const now = Date.now();
    const adRef = db.collection("ads").doc(adId);
    const adSnap = await transaction.get(adRef);

    if (!adSnap.exists) {
        throw new Error("Ad not found");
    }

    const ad = adSnap.data() ?? {};
    assertPromotionState("ad", ad, promotion, now);

    const ownerUserId = typeof ad.userId === "string" ? ad.userId : null;

    if (promotion === "bump") {
        transaction.update(adRef, {
            bumpAt: now,
            status: "active",
        });

        return {
            ownerUserId,
            promotionUntil: null,
            queued: false,
        };
    }

    if (promotion === "gold") {
        const promotionUntil = now + 7 * DAY;
        transaction.update(adRef, {
            highlightType: "gold",
            highlightUntil: promotionUntil,
            status: "active",
        });

        return {
            ownerUserId,
            promotionUntil,
            queued: false,
        };
    }

    const city = requireString(ad.city, "ad city");
    const activePinSnap = await transaction.get(
        db.collection("ads")
            .where("city", "==", city)
            .where("pinType", "==", promotion)
    );

    let activeCount = 0;
    activePinSnap.docs.forEach((doc) => {
        const data = doc.data();
        if (doc.id !== adId && typeof data.pinnedUntil === "number" && data.pinnedUntil > now) {
            activeCount++;
        }
    });

    const limit = AD_TOP_LIMITS[promotion];
    const hasFreeSlot = activeCount < limit;
    const promotionUntil = hasFreeSlot ? now + 3 * DAY : null;

    transaction.update(adRef, hasFreeSlot
        ? {
            pinType: promotion,
            pinnedAt: now,
            pinnedUntil: promotionUntil,
            pinQueueAt: null,
            status: "active",
        }
        : {
            pinType: promotion,
            pinnedAt: null,
            pinnedUntil: null,
            pinQueueAt: now,
            status: "active",
        }
    );

    return {
        ownerUserId,
        promotionUntil,
        queued: !hasFreeSlot,
    };
}

async function applyAuctionPromotion(
    transaction: FirebaseFirestore.Transaction,
    auctionId: string,
    promotion: AuctionPromotion
): Promise<PromotionResult> {
    const now = Date.now();
    const auctionRef = db.collection("auctions").doc(auctionId);
    const auctionSnap = await transaction.get(auctionRef);

    if (!auctionSnap.exists) {
        throw new Error("Auction not found");
    }

    const auction = auctionSnap.data() ?? {};
    assertPromotionState("auction", auction, promotion, now);

    const ownerUserId = typeof auction.ownerId === "string" ? auction.ownerId : null;

    if (promotion === "highlight-gold") {
        const promotionUntil = now + 7 * DAY;
        transaction.update(auctionRef, {
            promotionType: promotion,
            promotionUntil,
            promotionQueueAt: null,
            status: "active",
        });

        return {
            ownerUserId,
            promotionUntil,
            queued: false,
        };
    }

    const voivodeship = requireString(auction.voivodeship, "auction voivodeship");
    const city = requireString(auction.city, "auction city");
    const activePromotionSnap = await transaction.get(
        db.collection("auctions")
            .where("voivodeship", "==", voivodeship)
            .where("city", "==", city)
            .where("promotionType", "==", promotion)
    );

    let activeCount = 0;
    activePromotionSnap.docs.forEach((doc) => {
        const data = doc.data();
        if (doc.id !== auctionId && typeof data.promotionUntil === "number" && data.promotionUntil > now) {
            activeCount++;
        }
    });

    const limit = AUCTION_PROMOTION_LIMITS[promotion];
    const hasFreeSlot = activeCount < limit;
    const promotionUntil = hasFreeSlot ? now + 3 * DAY : null;

    transaction.update(auctionRef, hasFreeSlot
        ? {
            promotionType: promotion,
            promotionUntil,
            promotionQueueAt: null,
            status: "active",
        }
        : {
            promotionType: promotion,
            promotionUntil: null,
            promotionQueueAt: now,
            status: "active",
        }
    );

    return {
        ownerUserId,
        promotionUntil,
        queued: !hasFreeSlot,
    };
}
