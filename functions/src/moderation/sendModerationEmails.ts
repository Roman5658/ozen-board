import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { Resend } from "resend";

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

type ModerationAction = "reviewed" | "warning" | "block_user" | "rejected";

type UserContact = {
    id: string;
    email: string | null;
    nickname: string;
};

type ReportEmailClaim = {
    reportId: string;
    action: ModerationAction;
    actionReason: string;
    reporterMessage: string;
    reportedUserMessage: string;
    reporterId: string | null;
    reportedUserId: string | null;
};

const SUPPORT_MESSAGE_UK = "Якщо ви вважаєте це помилкою, зверніться до підтримки через платформу Xoven.";
const SUPPORT_MESSAGE_PL = "Jeśli uważasz, że to pomyłka, skontaktuj się z pomocą przez platformę Xoven.";

export const sendReportModerationEmails = onDocumentUpdated(
    {
        document: "reports/{reportId}",
        secrets: [RESEND_API_KEY],
    },
    async (event) => {
        const before = event.data?.before.data() ?? null;
        const after = event.data?.after.data() ?? null;
        if (!after) return;

        const action = getModerationAction(after.moderationAction);
        if (!action) return;
        if (!after.processedAt) return;

        const beforeProcessedAt = toMillis(before?.processedAt);
        const afterProcessedAt = toMillis(after.processedAt);
        const actionChanged = before?.moderationAction !== after.moderationAction;
        if (!actionChanged && beforeProcessedAt === afterProcessedAt) return;

        const reportRef = db.collection("reports").doc(event.params.reportId);
        const claim = await db.runTransaction(async (transaction): Promise<ReportEmailClaim | null> => {
            const snap = await transaction.get(reportRef);
            if (!snap.exists) return null;

            const report = snap.data() ?? {};
            const currentAction = getModerationAction(report.moderationAction);
            if (!currentAction || !report.processedAt) return null;

            const shouldEmailReportedUser = currentAction === "warning" || currentAction === "block_user";
            const reporterAlreadySent = report.reporterModerationEmailSent === true &&
                report.reporterModerationEmailAction === currentAction;
            const reportedAlreadySent = report.reportedUserModerationEmailSent === true &&
                report.reportedUserModerationEmailAction === currentAction;
            if (reporterAlreadySent && (!shouldEmailReportedUser || reportedAlreadySent)) {
                return null;
            }

            transaction.update(reportRef, {
                moderationEmailSendingAt: admin.firestore.FieldValue.serverTimestamp(),
                moderationEmailError: null,
            });

            return {
                reportId: event.params.reportId,
                action: currentAction,
                actionReason: getString(report.actionReason) ?? "Za naruszenie zasad platformy / За порушення правил платформи",
                reporterMessage: getString(report.reporterMessage) ?? "",
                reportedUserMessage: getString(report.reportedUserMessage) ?? "",
                reporterId: getString(report.reporterId) ?? getString(report.reportedBy),
                reportedUserId: getString(report.reportedUserId) ?? getString(report.senderId) ?? await getTargetOwnerId(report),
            };
        });

        if (!claim) return;

        try {
            const resend = new Resend(RESEND_API_KEY.value());
            const from = requireEnv("RECEIPTS_FROM_EMAIL");

            const reporter = claim.reporterId ? await getUserContact(claim.reporterId) : null;
            if (reporter?.email) {
                await sendReporterEmail(resend, from, reporter.email, claim);
                await reportRef.update({
                    reporterModerationEmailSent: true,
                    reporterModerationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
                    reporterModerationEmailAction: claim.action,
                });
            }

            if ((claim.action === "warning" || claim.action === "block_user") && claim.reportedUserId) {
                const reported = await getUserContact(claim.reportedUserId);
                if (reported.email) {
                    await sendReportedUserEmail(resend, from, reported.email, claim);
                    await reportRef.update({
                        reportedUserModerationEmailSent: true,
                        reportedUserModerationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
                        reportedUserModerationEmailAction: claim.action,
                    });
                }
            }

            await reportRef.update({
                moderationEmailSendingAt: null,
                moderationEmailError: null,
            });
        } catch (error) {
            const message = getErrorMessage(error);
            console.error(`Moderation email failed for report ${claim.reportId}:`, message);
            await reportRef.update({
                moderationEmailSendingAt: null,
                moderationEmailError: message,
                moderationEmailLastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
    }
);

export const sendUserUnblockedEmail = onDocumentUpdated(
    {
        document: "users/{userId}",
        secrets: [RESEND_API_KEY],
    },
    async (event) => {
        const before = event.data?.before.data() ?? null;
        const after = event.data?.after.data() ?? null;
        if (!after) return;
        if (before?.status !== "blocked" || after.status !== "active") return;
        if (after.unblockEmailSent === true) return;

        const userRef = db.collection("users").doc(event.params.userId);

        try {
            const to = getString(after.email) ?? (event.params.userId.includes("@") ? event.params.userId : null);
            if (!to) return;

            const resend = new Resend(RESEND_API_KEY.value());
            const from = requireEnv("RECEIPTS_FROM_EMAIL");

            const result = await resend.emails.send({
                from,
                to,
                subject: "Xoven — акаунт розблоковано / konto odblokowane",
                text: [
                    "UK",
                    "Ваш акаунт Xoven розблоковано. Ви знову можете користуватися платформою.",
                    "",
                    "PL",
                    "Twoje konto Xoven zostało odblokowane. Możesz ponownie korzystać z platformy.",
                ].join("\n"),
                html: `
                    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
                        <h2>Xoven</h2>
                        <h3>UK</h3>
                        <p>Ваш акаунт Xoven розблоковано. Ви знову можете користуватися платформою.</p>
                        <hr>
                        <h3>PL</h3>
                        <p>Twoje konto Xoven zostało odblokowane. Możesz ponownie korzystać z platformy.</p>
                    </div>
                `,
            });

            if (result.error) throw new Error(result.error.message);

            await userRef.update({
                unblockEmailSent: true,
                unblockEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
                unblockEmailError: null,
            });
        } catch (error) {
            const message = getErrorMessage(error);
            console.error(`Unblock email failed for user ${event.params.userId}:`, message);
            await userRef.update({
                unblockEmailError: message,
                unblockEmailLastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
    }
);

async function sendReporterEmail(resend: Resend, from: string, to: string, claim: ReportEmailClaim) {
    const result = await resend.emails.send({
        from,
        to,
        subject: "Вашу скаргу розглянуто — Xoven / Twoje zgłoszenie zostało rozpatrzone — Xoven",
        text: [
            "UK",
            "Дякуємо за повідомлення. Ми розглянули вашу скаргу.",
            `Результат: ${getActionLabelUk(claim.action)}.`,
            claim.reporterMessage,
            "",
            "PL",
            "Dziękujemy za zgłoszenie. Sprawdziliśmy Twoje zgłoszenie.",
            `Wynik: ${getActionLabelPl(claim.action)}.`,
            claim.reporterMessage,
        ].join("\n"),
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
                <h2>Xoven</h2>
                <h3>UK</h3>
                <p>Дякуємо за повідомлення. Ми розглянули вашу скаргу.</p>
                <p><b>Результат:</b> ${escapeHtml(getActionLabelUk(claim.action))}</p>
                <p>${escapeHtml(claim.reporterMessage)}</p>
                <hr>
                <h3>PL</h3>
                <p>Dziękujemy za zgłoszenie. Sprawdziliśmy Twoje zgłoszenie.</p>
                <p><b>Wynik:</b> ${escapeHtml(getActionLabelPl(claim.action))}</p>
                <p>${escapeHtml(claim.reporterMessage)}</p>
            </div>
        `,
    });

    if (result.error) throw new Error(result.error.message);
}

async function sendReportedUserEmail(resend: Resend, from: string, to: string, claim: ReportEmailClaim) {
    const result = await resend.emails.send({
        from,
        to,
        subject: "Повідомлення від модерації Xoven / Wiadomość od moderacji Xoven",
        text: [
            "UK",
            "Ваш акаунт або повідомлення було перевірено модерацією.",
            `Рішення: ${getActionLabelUk(claim.action)}.`,
            `Причина: ${claim.actionReason}.`,
            claim.reportedUserMessage,
            SUPPORT_MESSAGE_UK,
            "",
            "PL",
            "Twoje konto lub wiadomość zostały sprawdzone przez moderację.",
            `Decyzja: ${getActionLabelPl(claim.action)}.`,
            `Powód: ${claim.actionReason}.`,
            claim.reportedUserMessage,
            SUPPORT_MESSAGE_PL,
        ].join("\n"),
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
                <h2>Xoven</h2>
                <h3>UK</h3>
                <p>Ваш акаунт або повідомлення було перевірено модерацією.</p>
                <p><b>Рішення:</b> ${escapeHtml(getActionLabelUk(claim.action))}</p>
                <p><b>Причина:</b> ${escapeHtml(claim.actionReason)}</p>
                <p>${escapeHtml(claim.reportedUserMessage)}</p>
                <p>${escapeHtml(SUPPORT_MESSAGE_UK)}</p>
                <hr>
                <h3>PL</h3>
                <p>Twoje konto lub wiadomość zostały sprawdzone przez moderację.</p>
                <p><b>Decyzja:</b> ${escapeHtml(getActionLabelPl(claim.action))}</p>
                <p><b>Powód:</b> ${escapeHtml(claim.actionReason)}</p>
                <p>${escapeHtml(claim.reportedUserMessage)}</p>
                <p>${escapeHtml(SUPPORT_MESSAGE_PL)}</p>
            </div>
        `,
    });

    if (result.error) throw new Error(result.error.message);
}

async function getTargetOwnerId(report: FirebaseFirestore.DocumentData): Promise<string | null> {
    const targetType = getString(report.targetType);
    const targetId = getString(report.targetId);
    if (!targetType || !targetId) return null;

    const collectionName = targetType === "auction" ? "auctions" : targetType === "ad" ? "ads" : null;
    if (!collectionName) return null;

    const snap = await db.collection(collectionName).doc(targetId).get();
    if (!snap.exists) return null;

    const data = snap.data() ?? {};
    return targetType === "auction" ? getString(data.ownerId) : getString(data.userId);
}

async function getUserContact(userId: string): Promise<UserContact> {
    const normalized = userId.trim().toLowerCase();
    const emailFromId = normalized.includes("@") ? normalized : null;

    if (emailFromId) {
        const snap = await db.collection("users").doc(emailFromId).get();
        const data = snap.exists ? snap.data() ?? {} : {};
        return {
            id: userId,
            email: getString(data.email) ?? emailFromId,
            nickname: getString(data.nickname) ?? emailFromId.split("@")[0],
        };
    }

    const usersSnap = await db.collection("users").where("uid", "==", userId).limit(1).get();
    const docSnap = usersSnap.docs[0];
    const data = docSnap?.data() ?? {};
    const email = getString(data.email) ?? (docSnap?.id.includes("@") ? docSnap.id : null);

    return {
        id: userId,
        email,
        nickname: getString(data.nickname) ?? email?.split("@")[0] ?? "User",
    };
}

function getModerationAction(value: unknown): ModerationAction | null {
    return value === "reviewed" || value === "warning" || value === "block_user" || value === "rejected"
        ? value
        : null;
}

function getActionLabelUk(action: ModerationAction): string {
    if (action === "reviewed") return "Скаргу переглянуто";
    if (action === "warning") return "Користувача попереджено";
    if (action === "block_user") return "Користувача заблоковано";
    return "Скаргу відхилено";
}

function getActionLabelPl(action: ModerationAction): string {
    if (action === "reviewed") return "Zgłoszenie sprawdzone";
    if (action === "warning") return "Użytkownik ostrzeżony";
    if (action === "block_user") return "Użytkownik zablokowany";
    return "Zgłoszenie odrzucone";
}

function getString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toMillis(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value === "object" && "toMillis" in value) {
        const timestamp = value as { toMillis?: () => number };
        return timestamp.toMillis?.() ?? null;
    }

    return null;
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not configured`);
    return value;
}

function getErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.length > 1000 ? `${message.slice(0, 1000)}...` : message;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
