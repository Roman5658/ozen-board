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
    text: string
) {
    const clean = text.trim()
    if (!clean) return

    await addDoc(collection(db, "chats", chatId, "messages"), {
        senderId,
        text: clean,
        createdAt: serverTimestamp(),
    })

    await updateDoc(doc(db, "chats", chatId), {
        lastMessage: clean,
        updatedAt: serverTimestamp(),
        unreadFor: arrayUnion(otherUserId),
        hidden: false,
        hiddenFor: arrayRemove(otherUserId),
        [`hiddenForAt.${otherUserId}`]: null,
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
export async function getUserChats(userId: string): Promise<ChatItem[]> {
    const q = query(
        collection(db, "chats"),
        where("users", "array-contains", userId),
        orderBy("updatedAt", "desc")
    )

    const snap = await getDocs(q)

    return snap.docs
        .map(d => {
            const data = d.data() as {
                users?: unknown
                lastMessage?: unknown
                unreadFor?: unknown
                hiddenFor?: unknown
                hiddenForAt?: Record<string, unknown>
                hidden?: unknown
                updatedAt?: { toMillis?: () => number }
                createdAt?: { toMillis?: () => number }
            }



            return {
                id: d.id,
                users: Array.isArray(data.users) ? data.users : [],
                lastMessage:
                    typeof data.lastMessage === "string"
                        ? data.lastMessage
                        : "",
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

}

