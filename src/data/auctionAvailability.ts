import { collection, getDocs, query, where } from "firebase/firestore"
import { db } from "../app/firebase"



// Можно менять позже, но для MVP ставим так
export const TOP_AUCTION_LIMIT_PER_CITY = 3

export async function checkTopAuctionAvailability(params: {
    voivodeship: string
    city: string
}): Promise<{ ok: true } | { ok: false; reason: string; activeCount: number }> {
    const { voivodeship, city } = params

    const now = Date.now()

    // Берём все документы с promotionType == "top-auction" в нужном городе
    // и считаем только те, у кого promotionUntil ещё активен
    const q = query(
        collection(db, "auctions"),
        where("voivodeship", "==", voivodeship),
        where("city", "==", city),
        where("promotionType", "==", "top-auction")
    )

    const snap = await getDocs(q)

    let activeCount = 0

    for (const doc of snap.docs) {
        const data = doc.data() as {
            promotionUntil?: number | null
            createdAt?: number
        }

        const until = data.promotionUntil ?? null

        if (until && until > now) {
            activeCount++
        }
    }

    if (activeCount >= TOP_AUCTION_LIMIT_PER_CITY) {
        return {
            ok: false,
            reason: `Ліміт TOP-аукціонів у місті вже заповнений (${activeCount}/${TOP_AUCTION_LIMIT_PER_CITY}). Оберіть інше просування або зачекайте.`,
            activeCount,
        }
    }

    return { ok: true }
}
