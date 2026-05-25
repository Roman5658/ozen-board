import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { Resend } from "resend";

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const LOCK_TTL_MS = 10 * 60 * 1000;
const SUBJECT = "Xoven / Ozen Board — potwierdzenie płatności";
const RECEIPT_FIELDS = new Set([
    "receiptEmailSent",
    "receiptSentAt",
    "receiptEmailError",
    "receiptEmailLastAttemptAt",
    "receiptEmailSendingAt",
]);

type ReceiptPayment = {
    paymentId: string;
    to: string;
    amount: string;
    currency: string;
    orderId: string;
    promotionType: string;
    targetType: "ad" | "auction";
    targetId: string | null;
    status: "completed";
    paidAt: number | null;
};

export const sendPaymentReceipt = onDocumentWritten(
    {
        document: "payments/{paymentId}",
        secrets: [RESEND_API_KEY],
    },
    async (event) => {
        const change = event.data;
        if (!change || !change.after.exists) return;

        const before = change.before.exists ? change.before.data() ?? null : null;
        const after = change.after.data();
        if (!after) return;
        if (isReceiptOnlyUpdate(before, after)) return;

        const paymentId = event.params.paymentId;
        const paymentRef = db.collection("payments").doc(paymentId);

        const claimed = await db.runTransaction(async (transaction): Promise<ReceiptPayment | null> => {
            const snap = await transaction.get(paymentRef);
            if (!snap.exists) return null;

            const payment = snap.data() ?? {};
            const normalized = normalizePayment(payment, paymentId);
            if (!normalized) return null;

            const sendingAt = toMillis(payment.receiptEmailSendingAt);
            if (sendingAt && Date.now() - sendingAt < LOCK_TTL_MS) {
                return null;
            }

            transaction.update(paymentRef, {
                receiptEmailSendingAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            return normalized;
        });

        if (!claimed) return;

        try {
            const apiKey = RESEND_API_KEY.value();
            const from = requireEnv("RECEIPTS_FROM_EMAIL");
            const targetLink = buildTargetLink(claimed);
            const resend = new Resend(apiKey);

            const result = await resend.emails.send({
                from,
                to: claimed.to,
                subject: SUBJECT,
                text: buildReceiptText(claimed, targetLink),
                html: buildReceiptHtml(claimed, targetLink),
            });

            if (result.error) {
                throw new Error(result.error.message);
            }

            await paymentRef.update({
                receiptEmailSent: true,
                receiptSentAt: admin.firestore.FieldValue.serverTimestamp(),
                receiptEmailError: null,
            });
        } catch (error) {
            const message = getErrorMessage(error);
            console.error(`Payment receipt email failed for ${paymentId}:`, message);

            try {
                await paymentRef.update({
                    receiptEmailError: message,
                    receiptEmailLastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            } catch (updateError) {
                console.error(`Could not store receipt email error for ${paymentId}:`, updateError);
            }
        }
    }
);

function normalizePayment(
    payment: FirebaseFirestore.DocumentData,
    paymentId: string
): ReceiptPayment | null {
    if (payment.receiptEmailSent === true) return null;
    if (payment.status !== "completed") return null;

    const to = getString(payment.userEmail) ?? getString(payment.payerEmail);
    const amount = getAmount(payment.amount);
    const currency = getString(payment.currency);
    const orderId = getString(payment.orderId);
    const promotionType = getString(payment.promotionType);
    const targetType = getTargetType(payment.targetType);

    if (!to || !amount || !currency || !orderId || !promotionType || !targetType) {
        return null;
    }

    return {
        paymentId,
        to,
        amount,
        currency,
        orderId,
        promotionType,
        targetType,
        targetId: getString(payment.targetId),
        status: "completed",
        paidAt: toMillis(payment.capturedAt) ?? toMillis(payment.createdAt),
    };
}

function getString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getAmount(value: unknown): string | null {
    if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
    return getString(value);
}

function getTargetType(value: unknown): "ad" | "auction" | null {
    return value === "ad" || value === "auction" ? value : null;
}

function toMillis(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value === "object" && "toMillis" in value) {
        const timestamp = value as { toMillis?: () => number };
        return timestamp.toMillis?.() ?? null;
    }

    return null;
}

function isReceiptOnlyUpdate(
    before: FirebaseFirestore.DocumentData | null,
    after: FirebaseFirestore.DocumentData
): boolean {
    if (!before) return false;

    const changedKeys = new Set<string>();
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (!valuesEqual(before[key], after[key])) {
            changedKeys.add(key);
        }
    }

    return changedKeys.size > 0 && [...changedKeys].every((key) => RECEIPT_FIELDS.has(key));
}

function valuesEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true;

    const leftMillis = toMillis(left);
    const rightMillis = toMillis(right);
    if (leftMillis !== null || rightMillis !== null) {
        return leftMillis === rightMillis;
    }

    return JSON.stringify(left) === JSON.stringify(right);
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not configured`);
    }

    return value;
}

function buildTargetLink(payment: ReceiptPayment): string | null {
    if (!payment.targetId) return null;

    const baseUrl = requireEnv("APP_BASE_URL").replace(/\/+$/, "");
    const path = payment.targetType === "auction"
        ? `/auctions/${payment.targetId}`
        : `/ads/${payment.targetId}`;

    return `${baseUrl}${path}`;
}

function buildReceiptText(payment: ReceiptPayment, targetLink: string | null): string {
    const paidAt = payment.paidAt ? new Date(payment.paidAt).toISOString() : "-";
    const targetTextPl = targetLink
        ? `Publikacja: ${targetLink}`
        : "Płatność potwierdzona, publikacja nie została jeszcze zakończona.";
    const targetTextUk = targetLink
        ? `Публікація: ${targetLink}`
        : "Оплату підтверджено, публікацію ще не завершено.";

    return [
        "PL",
        "Dziękujemy za płatność za promowanie w Xoven / Ozen Board.",
        `Kwota: ${payment.amount} ${payment.currency}`,
        `Typ: ${payment.targetType}`,
        `Promowanie: ${payment.promotionType}`,
        `Status: ${payment.status}`,
        `Order ID: ${payment.orderId}`,
        `Data: ${paidAt}`,
        targetTextPl,
        "",
        "UK",
        "Дякуємо за оплату просування в Xoven / Ozen Board.",
        `Сума: ${payment.amount} ${payment.currency}`,
        `Тип: ${payment.targetType}`,
        `Просування: ${payment.promotionType}`,
        `Статус: ${payment.status}`,
        `Order ID: ${payment.orderId}`,
        `Дата: ${paidAt}`,
        targetTextUk,
    ].join("\n");
}

function buildReceiptHtml(payment: ReceiptPayment, targetLink: string | null): string {
    const paidAt = payment.paidAt ? new Date(payment.paidAt).toISOString() : "-";
    const targetHtmlPl = targetLink
        ? `Publikacja: <a href="${escapeHtml(targetLink)}">${escapeHtml(targetLink)}</a>`
        : "Płatność potwierdzona, publikacja nie została jeszcze zakończona.";
    const targetHtmlUk = targetLink
        ? `Публікація: <a href="${escapeHtml(targetLink)}">${escapeHtml(targetLink)}</a>`
        : "Оплату підтверджено, публікацію ще не завершено.";

    return `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
            <h2>Xoven / Ozen Board</h2>
            <h3>PL</h3>
            <p>Dziękujemy za płatność za promowanie w Xoven / Ozen Board.</p>
            <ul>
                <li>Kwota: ${escapeHtml(payment.amount)} ${escapeHtml(payment.currency)}</li>
                <li>Typ: ${escapeHtml(payment.targetType)}</li>
                <li>Promowanie: ${escapeHtml(payment.promotionType)}</li>
                <li>Status: ${escapeHtml(payment.status)}</li>
                <li>Order ID: ${escapeHtml(payment.orderId)}</li>
                <li>Data: ${escapeHtml(paidAt)}</li>
            </ul>
            <p>${targetHtmlPl}</p>
            <hr>
            <h3>UK</h3>
            <p>Дякуємо за оплату просування в Xoven / Ozen Board.</p>
            <ul>
                <li>Сума: ${escapeHtml(payment.amount)} ${escapeHtml(payment.currency)}</li>
                <li>Тип: ${escapeHtml(payment.targetType)}</li>
                <li>Просування: ${escapeHtml(payment.promotionType)}</li>
                <li>Статус: ${escapeHtml(payment.status)}</li>
                <li>Order ID: ${escapeHtml(payment.orderId)}</li>
                <li>Дата: ${escapeHtml(paidAt)}</li>
            </ul>
            <p>${targetHtmlUk}</p>
        </div>
    `;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.length > 1000 ? `${message.slice(0, 1000)}...` : message;
}
