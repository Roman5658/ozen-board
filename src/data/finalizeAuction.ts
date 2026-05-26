import {
    doc,
    runTransaction,
    updateDoc,
} from "firebase/firestore"
import { db } from "../app/firebase"
import { getOrCreateChat, sendAuctionEndedSystemMessage } from "./chats"

type AuctionFinalizeData = {
    status?: string
    endsAt?: number
    currentBid?: number
    startPrice?: number
    currentBidderId?: string | null
    winnerId?: string | null
    winnerChatNotifiedAt?: number | null
    winnerChatNotificationStatus?: string | null
    ownerId?: string
    title?: string
}

export async function finalizeAuction(auctionId: string) {
    const ref = doc(db, "auctions", auctionId)
    let shouldCreateWinnerChat = false
    let winnerId: string | null = null
    let ownerId: string | null = null
    let auctionTitle = "Аукціон"
    let finalPrice = 0
    const now = Date.now()

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists()) return

        const auction = snap.data() as AuctionFinalizeData
        const isActiveAndEnded =
            auction.status === "active" &&
            typeof auction.endsAt === "number" &&
            now >= auction.endsAt
        const isAlreadyEndedOrExpired = auction.status === "ended" || auction.status === "expired"
        const existingWinnerId = auction.winnerId ?? auction.currentBidderId ?? null
        const notificationAlreadyHandled =
            !!auction.winnerChatNotifiedAt ||
            auction.winnerChatNotificationStatus === "sending" ||
            auction.winnerChatNotificationStatus === "sent"

        if (!isActiveAndEnded && !isAlreadyEndedOrExpired) return

        winnerId = existingWinnerId
        ownerId = typeof auction.ownerId === "string" ? auction.ownerId : null
        auctionTitle = typeof auction.title === "string" && auction.title.trim()
            ? auction.title
            : auctionTitle
        finalPrice = typeof auction.currentBid === "number"
            ? auction.currentBid
            : typeof auction.startPrice === "number"
                ? auction.startPrice
                : finalPrice

        const patch: Record<string, unknown> = {}
        if (isActiveAndEnded) {
            patch.status = "ended"
            patch.winnerId = winnerId
        }

        if (!winnerId || !ownerId || notificationAlreadyHandled) {
            if (Object.keys(patch).length > 0) tx.update(ref, patch)
            return
        }

        patch.winnerChatNotificationStatus = "sending"
        patch.winnerChatNotificationStartedAt = now
        tx.update(ref, patch)
        shouldCreateWinnerChat = true
    })

    if (!shouldCreateWinnerChat || !ownerId || !winnerId) return

    try {
        const chatId = await getOrCreateChat(ownerId, winnerId)
        await sendAuctionEndedSystemMessage({
            chatId,
            sellerId: ownerId,
            winnerId,
            auctionId,
            auctionTitle,
            text: buildAuctionEndedSystemMessage(
                auctionTitle,
                finalPrice,
                buildAuctionUrl(auctionId)
            ),
        })

        await updateDoc(ref, {
            winnerChatId: chatId,
            winnerChatNotifiedAt: Date.now(),
            winnerChatNotificationStatus: "sent",
            winnerChatNotificationError: null,
        })
    } catch (error) {
        console.warn("[auction] failed to create winner chat", error)
        try {
            await updateDoc(ref, {
                winnerChatNotificationStatus: "failed",
                winnerChatNotificationError:
                    error instanceof Error ? error.message : String(error),
            })
        } catch (updateError) {
            console.warn("[auction] failed to store winner chat error", updateError)
        }
    }
}

function buildAuctionEndedSystemMessage(title: string, price: number, auctionUrl: string): string {
    const formattedPrice = `${price.toFixed(2)} zł`

    return [
        `Аукціон завершено: ${title}.`,
        `Фінальна ціна: ${formattedPrice}.`,
        "Для зв’язку напишіть у цьому чаті.",
        `Переглянути аукціон: ${auctionUrl}`,
        "",
        `Aukcja zakończona: ${title}.`,
        `Cena końcowa: ${formattedPrice}.`,
        "Aby się skontaktować, napisz w tym czacie.",
        `Zobacz aukcję: ${auctionUrl}`,
    ].join("\n")
}

function buildAuctionUrl(auctionId: string): string {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    return `${origin}/auction/${auctionId}`
}
