import { collection, getDocs, query, where } from "firebase/firestore"
import { db } from "../app/firebase"



// Можно менять позже, но для MVP ставим так
export const AUCTION_LIMITS = {
    top: 3,
    featured: 6,
} as const
type AvailabilityResult =
    | {
    ok: true
    activeCount: number
    limit: number
    queueCount: number
}
    | {
    ok: false
    reason: string
    activeCount: number
    limit: number
    queueCount: number
}


export async function checkAuctionPromotionAvailability(params: {
    voivodeship: string
    city: string
    type: "top" | "featured"
}): Promise<AvailabilityResult> {
    const { voivodeship, city, type } = params
    const now = Date.now()

    const limit = AUCTION_LIMITS[type]

    const q = query(
        collection(db, "auctions"),
        where("voivodeship", "==", voivodeship),
        where("city", "==", city),
        where("promotionType", "==", type)
    )

    const snap = await getDocs(q)

    let activeCount = 0
    let queueCount = 0

    for (const doc of snap.docs) {
        const data = doc.data() as {
            promotionUntil?: number | null
            promotionQueueAt?: number | null
        }

        if (data.promotionUntil && data.promotionUntil > now) {
            activeCount++
        } else if (data.promotionQueueAt) {
            queueCount++
        }
    }

    if (activeCount >= limit) {
        return {
            ok: false,
            reason: `У місті немає вільних місць (${activeCount}/${limit}). Буде додано в чергу.`,
            activeCount,
            limit,
            queueCount,
        }
    }

    return {
        ok: true,
        activeCount,
        limit,
        queueCount,
    }
}

