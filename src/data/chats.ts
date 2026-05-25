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
} from "firebase/firestore"

export type ChatItem = {
    id: string
    users: string[]
    lastMessage: string
    lastSenderType?: "user" | "system"
    lastSenderName?: string
    unreadFor?: string[]
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
        lastSenderType: "user",
        lastSenderName: senderName?.trim() || null,
        updatedAt: serverTimestamp(),
        unreadFor: arrayUnion(otherUserId),
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
        lastSenderType: "system",
        lastSenderName: "Xoven Admin",
        updatedAt: serverTimestamp(),
        unreadFor: arrayUnion(params.ownerId),
        hidden: false,
        hiddenFor: arrayRemove(params.ownerId),
        [`hiddenForAt.${params.ownerId}`]: null,
    })
}

/**
 * Пометить чат как прочитанный
 */
export async function markChatAsRead(chatId: string, userId: string) {
    await updateDoc(doc(db, "chats", chatId), {
        unreadFor: arrayRemove(userId),
    })
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
        .map(d => {
            const data = d.data() as {
                users?: unknown
                lastMessage?: unknown
                lastSenderType?: unknown
                lastSenderName?: unknown
                unreadFor?: unknown
                hiddenFor?: unknown
                hiddenForAt?: Record<string, unknown>
                hidden?: unknown
                updatedAt?: { toMillis?: () => number }
                createdAt?: { toMillis?: () => number }
            }

            const lastSenderType: ChatItem["lastSenderType"] =
                data.lastSenderType === "system" || data.lastSenderType === "user"
                    ? data.lastSenderType
                    : undefined


            return {
                id: d.id,
                users: Array.isArray(data.users) ? data.users : [],
                lastMessage:
                    typeof data.lastMessage === "string"
                        ? data.lastMessage
                        : "",
                lastSenderType,
                lastSenderName:
                    typeof data.lastSenderName === "string"
                        ? data.lastSenderName
                        : undefined,
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

                updatedAt: data.updatedAt?.toMillis?.(),
                createdAt: data.createdAt?.toMillis?.(),
            }


        })
        .filter(chat => !chat.hidden)
        .filter(chat => !(chat.hiddenFor?.includes(userId)))
        .filter(chat => !(userUid && chat.hiddenFor?.includes(userUid)))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

}


export async function getChatUsers(chatId: string): Promise<string[]> {
    const snap = await getDoc(doc(db, "chats", chatId))
    if (!snap.exists()) return []
    const data = snap.data() as { users?: unknown }
    return Array.isArray(data.users) ? data.users.filter((x): x is string => typeof x === "string") : []
}

