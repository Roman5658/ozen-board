
import { db } from "../app/firebase"
import type { AppUser } from "../types/user"
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore"

export async function isNicknameTaken(nickname: string): Promise<boolean> {

    const q = query(collection(db, "users"), where("nickname", "==", nickname.trim()))
    const snap = await getDocs(q)
    return !snap.empty
}

/**
 * Получить пользователя по email
 */
export async function getUserByEmail(email: string): Promise<AppUser | null> {
    const normalizedEmail = email.trim().toLowerCase()
    const snap = await getDoc(doc(db, "users", normalizedEmail))

    if (!snap.exists()) return null

    const data = snap.data() as Partial<AppUser>
    return {
        id: normalizedEmail,
        uid: typeof data.uid === "string" ? data.uid : "",
        email: normalizedEmail,
        nickname: typeof data.nickname === "string" ? data.nickname : normalizedEmail.split("@")[0],
        karma: typeof data.karma === "number" ? data.karma : 0,
        createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
        phone: typeof data.phone === "string" ? data.phone : null,
        telegram: typeof data.telegram === "string" ? data.telegram : null,
    }
}

/**
 * Создать пользователя (регистрация)
 */
export async function createUser(user: AppUser): Promise<void> {
    const normalizedEmail = user.email.trim().toLowerCase()
    const safeUser: AppUser = {
        id: normalizedEmail,
        uid: user.uid,
        email: normalizedEmail,
        nickname: user.nickname.trim(),
        karma: user.karma,
        createdAt: user.createdAt,
        phone: user.phone ?? null,
        telegram: user.telegram ?? null,
    }

    await setDoc(doc(db, "users", safeUser.id), safeUser, { merge: true })
}
