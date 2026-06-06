import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { Resend } from "resend";

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

const DAY = 24 * 60 * 60 * 1000;
const AUCTION_NOTIFICATION_LOCK_TTL = 10 * 60 * 1000;
const CHAT_EMAIL_COOLDOWN_MS = 2 * 60 * 1000;
const CHAT_EMAIL_SEND_LOCK_MS = 60 * 1000;

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

const ADS_ACTIVE_TTL = 30 * DAY;

export const expireOldAds = onSchedule(
    {
        schedule: "every day 03:30",
        timeZone: "Europe/Warsaw",
    },
    async () => {
        const now = Date.now();
        const cutoff = now - ADS_ACTIVE_TTL;
        const adsSnap = await db
            .collection("ads")
            .where("status", "==", "active")
            .get();

        let checkedCount = 0;
        let expiredCount = 0;
        let skippedWithoutCreatedAt = 0;
        let batch = db.batch();
        let batchUpdates = 0;

        const commitBatch = async () => {
            if (batchUpdates === 0) return;

            await batch.commit();
            batch = db.batch();
            batchUpdates = 0;
        };

        for (const adDoc of adsSnap.docs) {
            checkedCount++;

            const ad = adDoc.data();
            const createdAt = toMillis(ad.createdAt);

            if (!createdAt) {
                skippedWithoutCreatedAt++;
                continue;
            }

            if (createdAt > cutoff) continue;

            batch.update(adDoc.ref, {
                status: "expired",
                expiredAt: admin.firestore.FieldValue.serverTimestamp(),
                expirationProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
                expirationReason: "auto_30_days",
            });

            expiredCount++;
            batchUpdates++;

            if (batchUpdates >= 450) {
                await commitBatch();
            }
        }

        await commitBatch();

        console.log(
            `expireOldAds checked=${checkedCount} expired=${expiredCount} skippedWithoutCreatedAt=${skippedWithoutCreatedAt}`
        );
    }
);

type ChatEmailClaim = {
    chatId: string;
    messageId: string;
    recipientId: string;
    recipientEmail: string;
    senderName: string;
    chatLink: string;
};

export const sendChatMessageEmail = onDocumentCreated(
    {
        document: "chats/{chatId}/messages/{messageId}",
        secrets: [RESEND_API_KEY],
    },
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const message = snap.data() ?? {};
        const senderType = getString(message.senderType) ?? "user";
        if (senderType !== "user") return;

        const senderId = getString(message.senderId);
        if (!senderId) return;

        const chatId = event.params.chatId;
        const messageId = event.params.messageId;
        const chatRef = db.collection("chats").doc(chatId);
        const chatSnap = await chatRef.get();
        if (!chatSnap.exists) return;

        const chat = chatSnap.data() ?? {};
        const users = Array.isArray(chat.users)
            ? chat.users.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
            : [];
        const recipientIds = Array.from(new Set(users.filter((id) => id !== senderId)));

        if (recipientIds.length === 0) return;

        const senderName = getString(message.senderName) ?? await getDisplayName(senderId);
        const baseUrl = requireEnv("APP_BASE_URL").replace(/\/+$/, "");
        const resend = new Resend(RESEND_API_KEY.value());
        const from = requireEnv("RECEIPTS_FROM_EMAIL");

        await Promise.all(recipientIds.map(async (recipientId) => {
            try {
                const recipient = await getUserContact(recipientId);
                if (!recipient.email) return;

                const claim = await claimChatEmailNotification({
                    chatId,
                    messageId,
                    recipientId,
                    recipientEmail: recipient.email,
                    senderName,
                    chatLink: `${baseUrl}/chat/${chatId}`,
                });

                if (!claim) return;

                await sendChatEmail(resend, from, claim);

                await chatRef.update({
                    [`emailNotificationLastSentAt.${getUserKey(recipientId)}`]: Date.now(),
                    [`emailNotificationLastSentMessageId.${getUserKey(recipientId)}`]: messageId,
                    [`emailNotificationSendingAt.${getUserKey(recipientId)}`]: null,
                    [`emailNotificationError.${getUserKey(recipientId)}`]: null,
                });
            } catch (error) {
                const messageText = getErrorMessage(error);
                console.error(`Chat email notification failed for ${chatId}/${messageId}:`, messageText);

                await chatRef.update({
                    [`emailNotificationSendingAt.${getUserKey(recipientId)}`]: null,
                    [`emailNotificationError.${getUserKey(recipientId)}`]: messageText,
                    [`emailNotificationLastAttemptAt.${getUserKey(recipientId)}`]:
                        admin.firestore.FieldValue.serverTimestamp(),
                });
            }
        }));
    }
);

async function claimChatEmailNotification(claim: ChatEmailClaim): Promise<ChatEmailClaim | null> {
    const chatRef = db.collection("chats").doc(claim.chatId);
    const recipientKey = getUserKey(claim.recipientId);
    const now = Date.now();

    return db.runTransaction(async (transaction) => {
        const chatSnap = await transaction.get(chatRef);
        if (!chatSnap.exists) return null;

        const chat = chatSnap.data() ?? {};
        const lastSentAt = getNestedMillis(chat.emailNotificationLastSentAt, recipientKey);
        if (lastSentAt && now - lastSentAt < CHAT_EMAIL_COOLDOWN_MS) return null;

        const sendingAt = getNestedMillis(chat.emailNotificationSendingAt, recipientKey);
        if (sendingAt && now - sendingAt < CHAT_EMAIL_SEND_LOCK_MS) return null;

        transaction.update(chatRef, {
            [`emailNotificationSendingAt.${recipientKey}`]: now,
            [`emailNotificationLastAttemptAt.${recipientKey}`]:
                admin.firestore.FieldValue.serverTimestamp(),
        });

        return claim;
    });
}

async function sendChatEmail(resend: Resend, from: string, claim: ChatEmailClaim) {
    const result = await resend.emails.send({
        from,
        to: claim.recipientEmail,
        subject: "Нове повідомлення на Xoven / Nowa wiadomość na Xoven",
        text: buildChatEmailText(claim),
        html: buildChatEmailHtml(claim),
    });

    if (result.error) {
        throw new Error(result.error.message);
    }
}

function buildChatEmailText(claim: ChatEmailClaim): string {
    return [
        "UK",
        `Ви отримали нове повідомлення від ${claim.senderName}.`,
        "Щоб відповісти, відкрийте чат на Xoven.",
        `Відкрити чат: ${claim.chatLink}`,
        "",
        "PL",
        `Otrzymałeś nową wiadomość od ${claim.senderName}.`,
        "Aby odpowiedzieć, otwórz czat na Xoven.",
        `Otwórz czat: ${claim.chatLink}`,
    ].join("\n");
}

function buildChatEmailHtml(claim: ChatEmailClaim): string {
    return `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
            <h2>Xoven</h2>
            <h3>UK</h3>
            <p>Ви отримали нове повідомлення від ${escapeHtml(claim.senderName)}.</p>
            <p>Щоб відповісти, відкрийте чат на Xoven.</p>
            <p><a href="${escapeHtml(claim.chatLink)}">Відкрити чат</a></p>
            <hr>
            <h3>PL</h3>
            <p>Otrzymałeś nową wiadomość od ${escapeHtml(claim.senderName)}.</p>
            <p>Aby odpowiedzieć, otwórz czat na Xoven.</p>
            <p><a href="${escapeHtml(claim.chatLink)}">Otwórz czat</a></p>
        </div>
    `;
}

async function getDisplayName(userId: string): Promise<string> {
    const contact = await getUserContact(userId);
    return contact.nickname || contact.email || "Xoven";
}

/* ======================================================
   АУКЦИОНЫ — архивирование через 5 дней
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
            const status =
                typeof auction.status === "string" ? auction.status : "active";

            if (!endsAt) continue;
            if (now < endsAt + AUCTION_TTL) continue;
            if (status === "expired") continue;
            if (status === "hidden" || status === "removed" || status === "deleted") {
                continue;
            }

            const winnerId =
                typeof auction.winnerId === "string"
                    ? auction.winnerId
                    : typeof auction.currentBidderId === "string"
                        ? auction.currentBidderId
                        : null;

            await auctionDoc.ref.update({
                status: "expired",
                winnerId,
                expiredAt: now,
                cleanupProcessedAt: now,
            });

            console.log(`Auction ${auctionDoc.id} archived as expired`);
        }
    }
);

type AuctionWinnerNotificationClaim = {
    auctionId: string;
    sellerId: string;
    winnerId: string;
    title: string;
    city: string | null;
    finalPrice: number;
    chatId: string | null;
    chatAlreadyNotified: boolean;
    sellerEmailSent: boolean;
    winnerEmailSent: boolean;
};

type UserContact = {
    id: string;
    email: string | null;
    nickname: string;
};

type AuctionWinnerEmailRole = "seller" | "winner";

export const notifyEndedAuctionWinners = onSchedule(
    {
        schedule: "every 2 minutes",
        timeZone: "Europe/Warsaw",
        secrets: [RESEND_API_KEY],
    },
    async () => {
        const now = Date.now();
        const auctionsSnap = await db.collection("auctions").get();

        for (const auctionDoc of auctionsSnap.docs) {
            try {
                await processAuctionWinnerNotification(auctionDoc, now);
            } catch (error) {
                console.error(`Auction winner notification failed for ${auctionDoc.id}:`, error);
            }
        }
    }
);

async function processAuctionWinnerNotification(
    auctionDoc: FirebaseFirestore.QueryDocumentSnapshot,
    now: number
) {
    const auctionRef = auctionDoc.ref;
    const claim = await db.runTransaction(async (transaction): Promise<AuctionWinnerNotificationClaim | null> => {
        const snap = await transaction.get(auctionRef);
        if (!snap.exists) return null;

        const auction = snap.data() ?? {};
        const status = getString(auction.status) ?? "active";
        if (status === "hidden" || status === "removed" || status === "deleted") return null;

        const endsAt = getNumber(auction.endsAt);
        const isPastEnd = typeof endsAt === "number" && now >= endsAt;
        const isEndedLike = status === "ended" || status === "expired";
        if (!isPastEnd && !isEndedLike) return null;

        const sellerId = getString(auction.ownerId);
        const winnerId = getString(auction.winnerId) ?? getString(auction.currentBidderId);

        const patch: Record<string, unknown> = {};
        if (status === "active" && isPastEnd) {
            patch.status = "ended";
            patch.winnerId = winnerId ?? null;
        }

        if (!sellerId || !winnerId || sellerId === winnerId) {
            if (Object.keys(patch).length > 0) transaction.update(auctionRef, patch);
            return null;
        }

        if (auction.auctionWinnerNotificationSent === true) {
            if (Object.keys(patch).length > 0) transaction.update(auctionRef, patch);
            return null;
        }

        const sendingAt = toMillis(auction.auctionWinnerNotificationSendingAt);
        if (
            auction.auctionWinnerNotificationStatus === "sending" &&
            sendingAt &&
            now - sendingAt < AUCTION_NOTIFICATION_LOCK_TTL
        ) {
            return null;
        }

        patch.auctionWinnerNotificationStatus = "sending";
        patch.auctionWinnerNotificationSendingAt = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(auctionRef, patch);

        return {
            auctionId: auctionDoc.id,
            sellerId,
            winnerId,
            title: getString(auction.title) ?? "Aukcja",
            city: getString(auction.city),
            finalPrice: getNumber(auction.currentBid) ?? getNumber(auction.startPrice) ?? 0,
            chatId: getString(auction.winnerChatId),
            chatAlreadyNotified:
                !!toMillis(auction.winnerChatNotifiedAt) ||
                auction.winnerChatNotificationStatus === "sent",
            sellerEmailSent: auction.auctionWinnerSellerEmailSent === true,
            winnerEmailSent: auction.auctionWinnerWinnerEmailSent === true,
        };
    });

    if (!claim) return;

    try {
        const auctionRefForUpdate = db.collection("auctions").doc(claim.auctionId);
        const [seller, winner] = await Promise.all([
            getUserContact(claim.sellerId),
            getUserContact(claim.winnerId),
        ]);

        const chatRef = await getOrCreateAuctionWinnerChat(claim.sellerId, claim.winnerId, claim.chatId);
        const baseUrl = requireEnv("APP_BASE_URL").replace(/\/+$/, "");
        const links = {
            chatLink: `${baseUrl}/chat/${chatRef.id}`,
            auctionLink: `${baseUrl}/auction/${claim.auctionId}`,
        };

        if (!claim.chatAlreadyNotified) {
            await sendAuctionEndedChatMessage(chatRef, claim, links.auctionLink);
        }

        await auctionRefForUpdate.update({
            winnerChatId: chatRef.id,
            winnerChatNotifiedAt: Date.now(),
            winnerChatNotificationStatus: "sent",
            winnerChatNotificationError: null,
        });

        const resend = new Resend(RESEND_API_KEY.value());
        const from = requireEnv("RECEIPTS_FROM_EMAIL");

        let sellerEmailSent = claim.sellerEmailSent;
        let winnerEmailSent = claim.winnerEmailSent;

        if (!sellerEmailSent && seller.email) {
            await sendAuctionWinnerEmail(resend, from, seller.email, "seller", claim, winner, links);
            sellerEmailSent = true;
            await auctionRefForUpdate.update({
                auctionWinnerSellerEmailSent: true,
                auctionWinnerSellerEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        if (!winnerEmailSent && winner.email) {
            await sendAuctionWinnerEmail(resend, from, winner.email, "winner", claim, seller, links);
            winnerEmailSent = true;
            await auctionRefForUpdate.update({
                auctionWinnerWinnerEmailSent: true,
                auctionWinnerWinnerEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        if (!sellerEmailSent || !winnerEmailSent) {
            throw new Error("Seller or winner email is missing");
        }

        await auctionRefForUpdate.update({
            auctionWinnerNotificationSent: true,
            auctionWinnerNotificationSentAt: admin.firestore.FieldValue.serverTimestamp(),
            auctionWinnerNotificationStatus: "sent",
            auctionWinnerNotificationError: null,
        });
    } catch (error) {
        const message = getErrorMessage(error);
        console.error(`Auction winner notification failed for ${claim.auctionId}:`, message);

        await db.collection("auctions").doc(claim.auctionId).update({
            auctionWinnerNotificationStatus: "failed",
            auctionWinnerNotificationError: message,
            auctionWinnerNotificationLastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
}

async function getOrCreateAuctionWinnerChat(
    sellerId: string,
    winnerId: string,
    existingChatId: string | null
): Promise<FirebaseFirestore.DocumentReference> {
    if (existingChatId) {
        const existingRef = db.collection("chats").doc(existingChatId);
        const existingSnap = await existingRef.get();
        const users = existingSnap.exists ? existingSnap.data()?.users : null;
        if (Array.isArray(users) && users.includes(sellerId) && users.includes(winnerId)) {
            return existingRef;
        }
    }

    const chatsSnap = await db
        .collection("chats")
        .where("users", "array-contains", sellerId)
        .limit(50)
        .get();

    for (const chatDoc of chatsSnap.docs) {
        const users = chatDoc.data().users;
        if (Array.isArray(users) && users.includes(winnerId)) {
            return chatDoc.ref;
        }
    }

    return db.collection("chats").add({
        users: [sellerId, winnerId],
        lastMessage: "",
        lastMessageSenderId: null,
        lastSenderType: null,
        lastSenderName: null,
        unreadCounts: {},
        unreadFor: [],
        hidden: false,
        hiddenFor: [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

async function sendAuctionEndedChatMessage(
    chatRef: FirebaseFirestore.DocumentReference,
    claim: AuctionWinnerNotificationClaim,
    auctionLink: string
) {
    const messageRef = chatRef.collection("messages").doc(`auction-ended-${claim.auctionId}`);
    const text = buildAuctionEndedChatText(claim, auctionLink);

    await db.runTransaction(async (transaction) => {
        const messageSnap = await transaction.get(messageRef);
        if (messageSnap.exists) return;

        transaction.set(messageRef, {
            senderId: "system",
            senderType: "system",
            senderName: "Xoven Admin",
            text,
            targetType: "auction",
            targetId: claim.auctionId,
            targetTitle: claim.title,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        transaction.update(chatRef, {
            lastMessage: text,
            lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
            lastMessageSenderId: "system",
            lastSenderType: "system",
            lastSenderName: "Xoven Admin",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            unreadFor: admin.firestore.FieldValue.arrayUnion(claim.sellerId, claim.winnerId),
            [`unreadCounts.${getUserKey(claim.sellerId)}`]: admin.firestore.FieldValue.increment(1),
            [`unreadCounts.${getUserKey(claim.winnerId)}`]: admin.firestore.FieldValue.increment(1),
            hidden: false,
            hiddenFor: admin.firestore.FieldValue.arrayRemove(claim.sellerId, claim.winnerId),
            [`hiddenForAt.${claim.sellerId}`]: null,
            [`hiddenForAt.${claim.winnerId}`]: null,
        });
    });
}

function buildAuctionEndedChatText(claim: AuctionWinnerNotificationClaim, auctionLink: string): string {
    const price = `${claim.finalPrice.toFixed(2)} zł`;

    return [
        `Аукціон завершено: ${claim.title}.`,
        `Фінальна ціна: ${price}.`,
        "Для зв’язку напишіть у цьому чаті.",
        `Переглянути аукціон: ${auctionLink}`,
        "",
        `Aukcja zakończona: ${claim.title}.`,
        `Cena końcowa: ${price}.`,
        "Aby się skontaktować, napisz w tym czacie.",
        `Zobacz aukcję: ${auctionLink}`,
    ].join("\n");
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

    const usersSnap = await db
        .collection("users")
        .where("uid", "==", userId)
        .limit(1)
        .get();

    const docSnap = usersSnap.docs[0];
    const data = docSnap?.data() ?? {};
    const email = getString(data.email) ?? (docSnap?.id.includes("@") ? docSnap.id : null);

    return {
        id: userId,
        email,
        nickname: getString(data.nickname) ?? email?.split("@")[0] ?? "User",
    };
}

async function sendAuctionWinnerEmail(
    resend: Resend,
    from: string,
    to: string,
    role: AuctionWinnerEmailRole,
    claim: AuctionWinnerNotificationClaim,
    otherUser: UserContact,
    links: { chatLink: string; auctionLink: string }
) {
    const result = await resend.emails.send({
        from,
        to,
        subject: `Xoven / Ozen Board — aukcja zakończona: ${claim.title}`,
        text: buildAuctionWinnerEmailText(role, claim, otherUser, links),
        html: buildAuctionWinnerEmailHtml(role, claim, otherUser, links),
    });

    if (result.error) {
        throw new Error(result.error.message);
    }
}

function buildAuctionWinnerEmailText(
    role: AuctionWinnerEmailRole,
    claim: AuctionWinnerNotificationClaim,
    otherUser: UserContact,
    links: { chatLink: string; auctionLink: string }
): string {
    const price = `${claim.finalPrice.toFixed(2)} PLN`;
    const otherLabelPl = role === "seller" ? "Zwycięzca" : "Sprzedawca";
    const otherLabelUk = role === "seller" ? "Переможець" : "Продавець";

    return [
        "PL",
        role === "seller"
            ? "Twoja aukcja została zakończona."
            : "Wygrałeś aukcję.",
        `Aukcja: ${claim.title}`,
        `Cena końcowa: ${price}`,
        `${otherLabelPl}: ${otherUser.nickname}`,
        `Czat: ${links.chatLink}`,
        `Aukcja: ${links.auctionLink}`,
        "",
        "UK",
        role === "seller"
            ? "Ваш аукціон завершено."
            : "Ви виграли аукціон.",
        `Аукціон: ${claim.title}`,
        `Фінальна ціна: ${price}`,
        `${otherLabelUk}: ${otherUser.nickname}`,
        `Чат: ${links.chatLink}`,
        `Аукціон: ${links.auctionLink}`,
    ].join("\n");
}

function buildAuctionWinnerEmailHtml(
    role: AuctionWinnerEmailRole,
    claim: AuctionWinnerNotificationClaim,
    otherUser: UserContact,
    links: { chatLink: string; auctionLink: string }
): string {
    const price = `${claim.finalPrice.toFixed(2)} PLN`;
    const plIntro = role === "seller"
        ? "Twoja aukcja została zakończona."
        : "Wygrałeś aukcję.";
    const ukIntro = role === "seller"
        ? "Ваш аукціон завершено."
        : "Ви виграли аукціон.";
    const otherLabelPl = role === "seller" ? "Zwycięzca" : "Sprzedawca";
    const otherLabelUk = role === "seller" ? "Переможець" : "Продавець";

    return `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
            <h2>Xoven / Ozen Board</h2>
            <h3>PL</h3>
            <p>${escapeHtml(plIntro)}</p>
            <ul>
                <li>Aukcja: ${escapeHtml(claim.title)}</li>
                <li>Cena końcowa: ${escapeHtml(price)}</li>
                <li>${escapeHtml(otherLabelPl)}: ${escapeHtml(otherUser.nickname)}</li>
            </ul>
            <p><a href="${escapeHtml(links.chatLink)}">Otwórz czat</a></p>
            <p><a href="${escapeHtml(links.auctionLink)}">Otwórz aukcję</a></p>
            <hr>
            <h3>UK</h3>
            <p>${escapeHtml(ukIntro)}</p>
            <ul>
                <li>Аукціон: ${escapeHtml(claim.title)}</li>
                <li>Фінальна ціна: ${escapeHtml(price)}</li>
                <li>${escapeHtml(otherLabelUk)}: ${escapeHtml(otherUser.nickname)}</li>
            </ul>
            <p><a href="${escapeHtml(links.chatLink)}">Відкрити чат</a></p>
            <p><a href="${escapeHtml(links.auctionLink)}">Відкрити аукціон</a></p>
        </div>
    `;
}

function getString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toMillis(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value === "object" && "toMillis" in value) {
        const timestamp = value as { toMillis?: () => number };
        return timestamp.toMillis?.() ?? null;
    }

    return null;
}

function getNestedMillis(value: unknown, key: string): number | null {
    if (!value || typeof value !== "object") return null;
    return toMillis((value as Record<string, unknown>)[key]);
}

function getUserKey(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, char => `_${char.charCodeAt(0).toString(16)}_`);
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not configured`);
    }

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

export { verifyPayPalPayment } from "./paypal/verifyPayPalPayment";
export { sendPaymentReceipt } from "./paypal/sendPaymentReceipt";
export { sendReportModerationEmails, sendUserUnblockedEmail } from "./moderation/sendModerationEmails";
export { importOlxLeads } from "./leads/importOlxLeads";
export { createManualLead } from "./leads/createManualLead";

/* ======================================================
   ADS — автоматическая ротация PIN (TOP3 / TOP6)
====================================================== */

const TOP3_LIMIT = 3;
const TOP6_LIMIT = 6;

const TOP3_DURATION = 10 * DAY;
const TOP6_DURATION = 10 * DAY;

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
                const endsAt = doc.data().endsAt;
                if (typeof endsAt !== "number" || endsAt <= now) return;

                batch.update(doc.ref, {
                    promotionUntil: endsAt,
                    promotionQueueAt: null,
                });
                updates++;
            });

            queueFeatured.slice(0, freeFeatured).forEach(doc => {
                const endsAt = doc.data().endsAt;
                if (typeof endsAt !== "number" || endsAt <= now) return;

                batch.update(doc.ref, {
                    promotionUntil: endsAt,
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
