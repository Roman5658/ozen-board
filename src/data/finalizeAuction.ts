import {
    addDoc,
    collection,
    doc,
    getDocs,
    query,
    runTransaction,
    serverTimestamp,
    where,
} from "firebase/firestore"
import { db } from "../app/firebase"
import { getOrCreateChat, sendMessage } from "./chats"
type UserProfile = {
    id: string
    email: string
    nickname: string
}

async function getUserProfileByIdOrUid(userId: string): Promise<UserProfile | null> {
    const byDocIdSnap = await getDocs(query(collection(db, "users"), where("email", "==", userId)))
    const byUidSnap = await getDocs(query(collection(db, "users"), where("uid", "==", userId)))

    const docSnap = byDocIdSnap.docs[0] ?? byUidSnap.docs[0]
    if (!docSnap) return null

    const data = docSnap.data() as { id?: unknown; email?: unknown; nickname?: unknown }
    const email = typeof data.email === "string" ? data.email : docSnap.id

    return {
        id: typeof data.id === "string" ? data.id : email,
        email,
        nickname:
            typeof data.nickname === "string" && data.nickname.trim().length > 0
                ? data.nickname
                : email.split("@")[0],
    }
}

async function queueAuctionEndEmail(to: string, subject: string, text: string) {


    await addDoc(collection(db, "mail"), {
        to,
        message: { subject, text },
        createdAt: serverTimestamp(),
    })
}

export async function finalizeAuction(auctionId: string) {
    const ref = doc(db, "auctions", auctionId)
    let finalized = false
    let winnerId: string | null = null
    let ownerId: string | null = null
    let auctionTitle = "аукцион"

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)

        if (!snap.exists()) return

        // уже завершён — ничего не делаем
        const auction = snap.data() as {
            status?: string
            endsAt?: number
            currentBidderId?: string | null
            ownerId?: string
            title?: string
        }

        // ещё не закончен по времени
        if (auction.status !== "active") return
        if (typeof auction.endsAt !== "number" || Date.now() < auction.endsAt) return

        // если ставок не было — победителя нет
        winnerId = auction.currentBidderId ?? null
        ownerId = typeof auction.ownerId === "string" ? auction.ownerId : null
        auctionTitle = typeof auction.title === "string" ? auction.title : auctionTitle

        tx.update(ref, {
            status: "ended",
            winnerId,
        })

        finalized = true
    })
    if (!finalized || !ownerId || !winnerId) return

    const [owner, winner] = await Promise.all([
        getUserProfileByIdOrUid(ownerId),
        getUserProfileByIdOrUid(winnerId),
    ])

    if (!owner || !winner) return

    await Promise.all([
        queueAuctionEndEmail(
            owner.email,
            `Аукцион завершен: ${auctionTitle}`,
            `Ваш лот "${auctionTitle}" выиграл ${winner.nickname} (${winner.email}).`
        ),
        queueAuctionEndEmail(
            winner.email,
            `Вы выиграли аукцион: ${auctionTitle}`,
            `Поздравляем! Вы выиграли лот "${auctionTitle}". Продавец: ${owner.nickname} (${owner.email}).`
        ),
    ])

    const chatId = await getOrCreateChat(owner.id, winner.id)
    await sendMessage(
        chatId,
        owner.id,
        winner.id,
        `Аукцион "${auctionTitle}" завершён. Победитель: ${winner.nickname} (${winner.email}).`,
        owner.nickname
    )
}
