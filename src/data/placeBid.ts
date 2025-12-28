import {
    doc,
    runTransaction,
    collection,
} from "firebase/firestore"
import { db } from "../app/firebase"

type PlaceBidParams = {
    auctionId: string
    userId: string
    userName: string
    amount: number
}

export async function placeBid({
                                   auctionId,
                                   userId,
                                   userName,
                                   amount,
                               }: PlaceBidParams) {
    const auctionRef = doc(db, "auctions", auctionId)
    const bidsRef = collection(db, "auctionBids", auctionId, "bids")

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(auctionRef)

        if (!snap.exists()) {
            throw new Error("Аукціон не знайдено")
        }

        const auction = snap.data()

        if (auction.status !== "active") {
            throw new Error("Аукціон завершено")
        }

        if (auction.ownerId === userId) {
            throw new Error("Автор не може робити ставки")
        }

        if (amount <= auction.currentBid) {
            throw new Error("Ставка має бути більшою за поточну")
        }

        // 1️⃣ обновляем аукцион
        // 1️⃣ обновляем аукцион
        tx.update(auctionRef, {
            currentBid: amount,
            bidsCount: (auction.bidsCount ?? 0) + 1,
            currentBidderId: userId,
            currentBidderName: userName,
        })


        // 2️⃣ добавляем ставку
        const bidRef = doc(bidsRef)

        tx.set(bidRef, {
            auctionId,
            userId,
            userName,
            amount,
            createdAt: Date.now(),
        })
    })
}
