import { doc, runTransaction } from "firebase/firestore"
import { db } from "../app/firebase"

export async function finalizeAuction(auctionId: string) {
    const ref = doc(db, "auctions", auctionId)

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)

        if (!snap.exists()) {
            return
        }

        const auction = snap.data()

        // уже завершён — ничего не делаем
        if (auction.status !== "active") {
            return
        }

        // ещё не закончен по времени
        if (Date.now() < auction.endsAt) {
            return
        }

        // если ставок не было — победителя нет
        const winnerId = auction.currentBidderId ?? null

        tx.update(ref, {
            status: "ended",
            winnerId,
        })
    })
}
