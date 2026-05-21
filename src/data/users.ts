
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
    const id = email.trim().toLowerCase()
    const snap = await getDoc(doc(db, "users", id))

    if (!snap.exists()) return null
    return snap.data() as AppUser
}

/**
 * Создать пользователя (регистрация)
 */
export async function createUser(user: AppUser): Promise<void> {
    const safeUser: AppUser = {
        id: user.id,
        uid: user.uid,
        email: user.email,
        nickname: user.nickname,
        karma: user.karma,
        createdAt: user.createdAt,
        phone: user.phone ?? null,
        telegram: user.telegram ?? null,
    }

    await setDoc(doc(db, "users", safeUser.id), safeUser)
}
