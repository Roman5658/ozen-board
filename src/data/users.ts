
import { db } from "../app/firebase"
import type { AppUser } from "../types/user"
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore"

export const ACCOUNT_RESTRICTED_ERROR = "account-blocked"

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
        status: data.status === "blocked" ? "blocked" : "active",
        blockedAt: typeof data.blockedAt === "number" ? data.blockedAt : null,
        blockedReason: typeof data.blockedReason === "string" ? data.blockedReason : null,
        blockedBy: typeof data.blockedBy === "string" ? data.blockedBy : null,
        unblockedAt: typeof data.unblockedAt === "number" ? data.unblockedAt : null,
        unblockReason: typeof data.unblockReason === "string" ? data.unblockReason : null,
        unblockedBy: typeof data.unblockedBy === "string" ? data.unblockedBy : null,
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
        status: user.status === "blocked" ? "blocked" : "active",
        karma: user.karma,
        createdAt: user.createdAt,
        phone: user.phone ?? null,
        telegram: user.telegram ?? null,
    }

    await setDoc(doc(db, "users", safeUser.id), safeUser, { merge: true })
}

export function isAccountRestrictedError(error: unknown): boolean {
    return error instanceof Error && error.message === ACCOUNT_RESTRICTED_ERROR
}

export async function assertUserNotBlocked(userIdOrEmail: string): Promise<void> {
    const normalizedEmail = userIdOrEmail.trim().toLowerCase()
    if (!normalizedEmail) return

    const snap = await getDoc(doc(db, "users", normalizedEmail))
    if (snap.exists() && snap.data().status === "blocked") {
        throw new Error(ACCOUNT_RESTRICTED_ERROR)
    }
}
