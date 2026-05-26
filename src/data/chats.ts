import { db } from "../app/firebase"
import {
    addDoc,
    collection,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    getDoc,
    where,
    doc,
    updateDoc,
    arrayUnion,
    arrayRemove,
    increment,
    type QueryDocumentSnapshot,
    type Unsubscribe,
} from "firebase/firestore"

export type ChatItem = {
    id: string
    users: string[]
    lastMessage: string
    lastMessageAt?: number
    lastMessageSenderId?: string
    lastSenderType?: "user" | "system"
    lastSenderName?: string
    unreadCounts?: Record<string, number>
    unreadFor?: string[]
    hidden?: boolean
    hiddenFor?: string[]
    hiddenForAt?: Record<string, unknown>
    updatedAt?: number
    createdAt?: number
}


export type ChatMessage = {
    id: string
    senderId: string
    text: string
    senderType?: "user" | "system"
    senderName?: string
    targetType?: "ad" | "auction"
    targetId?: string
    targetTitle?: string
    moderationStatus?: "hidden" | "restored"
    moderationReason?: string | null
    createdAt?: unknown
}

function getUserKey(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, char => `_${char.charCodeAt(0).toString(16)}_`)
}

function toMillis(value: unknown): number | undefined {
    if (value && typeof value === "object" && "toMillis" in value) {
        const timestamp = value as { toMillis?: () => number }
        return timestamp.toMillis?.()
    }

    return undefined
}

function parseChatDoc(d: QueryDocumentSnapshot): ChatItem {
    const data = d.data() as {
        users?: unknown
        lastMessage?: unknown
        lastMessageAt?: unknown
        lastMessageSenderId?: unknown
        lastSenderType?: unknown
        lastSenderName?: unknown
        unreadCounts?: unknown
        unreadFor?: unknown
        hiddenFor?: unknown
        hiddenForAt?: Record<string, unknown>
        hidden?: unknown
        updatedAt?: unknown
        createdAt?: unknown
    }

    const lastSenderType: ChatItem["lastSenderType"] =
        data.lastSenderType === "system" || data.lastSenderType === "user"
            ? data.lastSenderType
            : undefined

    const unreadCounts = typeof data.unreadCounts === "object" && data.unreadCounts !== null
        ? Object.fromEntries(
            Object.entries(data.unreadCounts as Record<string, unknown>)
                .filter(([, value]) => typeof value === "number")
        ) as Record<string, number>
        : {}

    return {
        id: d.id,
        users: Array.isArray(data.users) ? data.users : [],
        lastMessage:
            typeof data.lastMessage === "string"
                ? data.lastMessage
                : "",
        lastMessageAt: toMillis(data.lastMessageAt),
        lastMessageSenderId:
            typeof data.lastMessageSenderId === "string"
                ? data.lastMessageSenderId
                : undefined,
        lastSenderType,
        lastSenderName:
            typeof data.lastSenderName === "string"
                ? data.lastSenderName
                : undefined,
        unreadCounts,
        unreadFor: Array.isArray(data.unreadFor)
            ? data.unreadFor
            : [],
        hidden: data.hidden === true,
        hiddenFor: Array.isArray(data.hiddenFor)
            ? data.hiddenFor
            : [],
        hiddenForAt:
            typeof data.hiddenForAt === "object"
                ? data.hiddenForAt
                : {},

        updatedAt: toMillis(data.updatedAt),
        createdAt: toMillis(data.createdAt),
    }
}

export function getUnreadCountForUser(chat: ChatItem, userIds: string[]): number {
    const ids = Array.from(new Set(userIds.filter(Boolean)))
    const unreadCount = ids.reduce((sum, id) => sum + (chat.unreadCounts?.[getUserKey(id)] ?? 0), 0)
    if (unreadCount > 0) return unreadCount

    return ids.some(id => chat.unreadFor?.includes(id)) ? 1 : 0
}

/**
 * Создать или получить чат между двумя пользователями
 */
export async function getOrCreateChat(
    userAId: string,
    userBId: string
): Promise<string> {
    if (userAId === userBId) {
        throw new Error("Неможливо створити чат із самим собою")
    }

    const chatsRef = collection(db, "chats")

    const q = query(
        chatsRef,
        where("users", "array-contains", userAId),
        limit(50)
    )

    const snap = await getDocs(q)

    for (const d of snap.docs) {
        const data = d.data() as { users?: unknown }
        const users = Array.isArray(data.users) ? data.users : []

        if (users.includes(userBId)) {
            return d.id
        }
    }

    const newChatRef = await addDoc(chatsRef, {
        users: [userAId, userBId],
        lastMessage: "",
        lastMessageSenderId: null,
        lastSenderType: null,
        lastSenderName: null,
        unreadCounts: {},
        unreadFor: [],
        hidden: true,
        hiddenFor: [],
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
    })


    return newChatRef.id
}


/**
 * Отправить сообщение + обновить чат
 */
export async function sendMessage(
    chatId: string,
    senderId: string,
    otherUserId: string,
    text: string,
    senderName?: string
) {
    const clean = text.trim()
    if (!clean) return

    await addDoc(collection(db, "chats", chatId, "messages"), {
        senderId,
        senderName: senderName?.trim() || null,
        senderType: "user",
        text: clean,
        createdAt: serverTimestamp(),
    })

    await updateDoc(doc(db, "chats", chatId), {
        lastMessage: clean,
        lastMessageAt: serverTimestamp(),
        lastMessageSenderId: senderId,
        lastSenderType: "user",
        lastSenderName: senderName?.trim() || null,
        updatedAt: serverTimestamp(),
        unreadFor: arrayUnion(otherUserId),
        [`unreadCounts.${getUserKey(otherUserId)}`]: increment(1),
        hidden: false,
        hiddenFor: arrayRemove(otherUserId),
        [`hiddenForAt.${otherUserId}`]: null,
    })

}

export async function sendAdminSystemMessage(params: {
    adminId: string
    ownerId: string
    text: string
    targetType: "ad" | "auction"
    targetId: string
    targetTitle?: string
    moderationStatus: "hidden" | "restored"
    moderationReason?: string | null
}) {
    if (!params.adminId || !params.ownerId || params.adminId === params.ownerId) return

    const chatId = await getOrCreateChat(params.adminId, params.ownerId)

    await addDoc(collection(db, "chats", chatId, "messages"), {
        senderId: params.adminId,
        senderType: "system",
        senderName: "Xoven Admin",
        text: params.text,
        targetType: params.targetType,
        targetId: params.targetId,
        targetTitle: params.targetTitle ?? null,
        moderationStatus: params.moderationStatus,
        moderationReason: params.moderationReason ?? null,
        createdAt: serverTimestamp(),
    })

    await updateDoc(doc(db, "chats", chatId), {
        lastMessage: params.text,
        lastMessageAt: serverTimestamp(),
        lastMessageSenderId: params.adminId,
        lastSenderType: "system",
        lastSenderName: "Xoven Admin",
        updatedAt: serverTimestamp(),
        unreadFor: arrayUnion(params.ownerId),
        [`unreadCounts.${getUserKey(params.ownerId)}`]: increment(1),
        hidden: false,
        hiddenFor: arrayRemove(params.ownerId),
        [`hiddenForAt.${params.ownerId}`]: null,
    })
}

/**
 * Отправить системное сообщение о завершенном аукционе.
 */
export async function sendAuctionEndedSystemMessage(params: {
    chatId: string
    sellerId: string
    winnerId: string
    auctionId: string
    auctionTitle?: string
    text: string
}) {
    const clean = params.text.trim()
    if (!clean) return

    const unreadUserIds = Array.from(new Set([params.sellerId, params.winnerId].filter(Boolean)))
    if (unreadUserIds.length === 0) return

    await addDoc(collection(db, "chats", params.chatId, "messages"), {
        senderId: "system",
        senderType: "system",
        senderName: "Xoven Admin",
        text: clean,
        targetType: "auction",
        targetId: params.auctionId,
        targetTitle: params.auctionTitle ?? null,
        createdAt: serverTimestamp(),
    })

    const patch: Record<string, unknown> = {
        lastMessage: clean,
        lastMessageAt: serverTimestamp(),
        lastMessageSenderId: "system",
        lastSenderType: "system",
        lastSenderName: "Xoven Admin",
        updatedAt: serverTimestamp(),
        unreadFor: arrayUnion(...unreadUserIds),
        hidden: false,
        hiddenFor: arrayRemove(...unreadUserIds),
    }

    unreadUserIds.forEach(userId => {
        patch[`unreadCounts.${getUserKey(userId)}`] = increment(1)
        patch[`hiddenForAt.${userId}`] = null
    })

    await updateDoc(doc(db, "chats", params.chatId), patch)
}

/**
 * Пометить чат как прочитанный
 */
export async function markChatAsRead(chatId: string, userId: string, userUid?: string, userEmail?: string) {
    const ids = Array.from(new Set([userId, userUid, userEmail].filter(Boolean))) as string[]
    const patch: Record<string, unknown> = {
        unreadFor: arrayRemove(...ids),
    }

    ids.forEach(id => {
        patch[`unreadCounts.${getUserKey(id)}`] = 0
    })

    await updateDoc(doc(db, "chats", chatId), patch)
}

/**
 * Подписка на сообщения (real-time)
 */
export function subscribeToChatMessages(
    chatId: string,
    cb: (messages: ChatMessage[]) => void
) {
    const q = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("createdAt", "asc"),
        limit(200)
    )

    return onSnapshot(q, (snap) => {
        const data: ChatMessage[] = snap.docs.map(d => ({
            id: d.id,
            ...(d.data() as Omit<ChatMessage, "id">),
        }))
        cb(data)
    })
}

/**
 * Получить список чатов пользователя
 */
export async function getUserChats(userId: string, userUid?: string): Promise<ChatItem[]> {
    const ids = Array.from(new Set([userId, userUid].filter(Boolean))) as string[]
    const snaps = await Promise.all(
        ids.map(id =>
            getDocs(
                query(
                    collection(db, "chats"),
                    where("users", "array-contains", id),
                    orderBy("updatedAt", "desc")
                )
            )
        )
    )

    const allDocs = new Map<string, (typeof snaps)[number]["docs"][number]>()
    for (const snap of snaps) {
        for (const d of snap.docs) allDocs.set(d.id, d)
    }

    return Array.from(allDocs.values())
        .map(parseChatDoc)
        .filter(chat => !chat.hidden)
        .filter(chat => !(chat.hiddenFor?.includes(userId)))
        .filter(chat => !(userUid && chat.hiddenFor?.includes(userUid)))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

}

export function subscribeToUserChats(
    userId: string,
    userUid: string | undefined,
    cb: (chats: ChatItem[]) => void
): Unsubscribe {
    const ids = Array.from(new Set([userId, userUid].filter(Boolean))) as string[]
    const docs = new Map<string, ChatItem>()
    const unsubscribers = ids.map(id => {
        const q = query(
            collection(db, "chats"),
            where("users", "array-contains", id),
            orderBy("updatedAt", "desc")
        )

        return onSnapshot(q, (snap) => {
            snap.docs.forEach(d => docs.set(d.id, parseChatDoc(d)))

            cb(
                Array.from(docs.values())
                    .filter(chat => !chat.hidden)
                    .filter(chat => !(chat.hiddenFor?.some(hiddenId => ids.includes(hiddenId))))
                    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
            )
        })
    })

    return () => unsubscribers.forEach(unsubscribe => unsubscribe())
}


export async function getChatUsers(chatId: string): Promise<string[]> {
    const snap = await getDoc(doc(db, "chats", chatId))
    if (!snap.exists()) return []
    const data = snap.data() as { users?: unknown }
    return Array.isArray(data.users) ? data.users.filter((x): x is string => typeof x === "string") : []
}

