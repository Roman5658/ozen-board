import {
    collection,
    getDocs,
    query,
    where,
} from "firebase/firestore"
import { db } from "../app/firebase"

type PinAvailability = {
    canTop3: boolean
    canTop5: boolean
    top3Used: number
    top5Used: number
}

const TOP3_LIMIT = 3
const TOP5_LIMIT = 5

export async function checkPinAvailability(
    city: string
): Promise<PinAvailability> {
    const now = Date.now()

    // берём только PIN-объявления по городу
    const snap = await getDocs(
        query(
            collection(db, "ads"),
            where("city", "==", city),
            where("isPinned", "==", true)
        )
    )

    // считаем только АКТИВНЫЕ
    const activePins = snap.docs.filter((doc) => {
        const data = doc.data()
        return (data.pinnedUntil ?? 0) > now
    })

    const used = activePins.length

    return {
        canTop3: used < TOP3_LIMIT,
        canTop5: used < TOP5_LIMIT,
        top3Used: Math.min(used, TOP3_LIMIT),
        top5Used: Math.min(used, TOP5_LIMIT),
    }
}
