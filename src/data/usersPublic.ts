import { doc, getDoc } from "firebase/firestore"
import { db } from "../app/firebase"

export async function getUserPublicNickname(userId: string): Promise<string> {
    const snap = await getDoc(doc(db, "users", userId))
    if (!snap.exists()) return "Користувач"

    const data: any = snap.data()
    return typeof data.nickname === "string" && data.nickname.trim()
        ? data.nickname
        : "Користувач"
}
