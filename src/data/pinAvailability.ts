import {
    collection,
    getDocs,
    query,
    where,
} from "firebase/firestore"
import { db } from "../app/firebase"

type PinAvailability = {
    canTop3: boolean
    canTop6: boolean
    top3Used: number
    top6Used: number
}

const TOP3_LIMIT = 3
const TOP6_LIMIT = 6

export async function checkPinAvailability(
    city: string
): Promise<PinAvailability> {
    const now = Date.now()

    const snap = await getDocs(
        query(
            collection(db, "ads"),
            where("city", "==", city),
            where("pinType", "in", ["top3", "top6"])
        )
    )

    const activePins = snap.docs
        .map(d => d.data())
        .filter(ad => (ad.pinnedUntil ?? 0) > now)

    const top3Used = activePins.filter(a => a.pinType === "top3").length
    const top6Used = activePins.filter(a => a.pinType === "top6").length

    return {
        canTop3: top3Used < TOP3_LIMIT,
        canTop6: top6Used < TOP6_LIMIT,
        top3Used,
        top6Used,
    }
}
