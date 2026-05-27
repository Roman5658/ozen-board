import { onAuthStateChanged, type User } from "firebase/auth"
import { auth } from "../app/firebase"

export const STALE_AUTH_SESSION_MESSAGE =
    "Сесія входу закінчилась. Увійдіть в акаунт ще раз."

type LocalAuthIdentity = {
    id?: string | null
    email?: string | null
    uid?: string | null
}

function normalize(value?: string | null) {
    return value?.trim().toLowerCase() ?? ""
}

function waitForAuthUser(timeoutMs = 1200): Promise<User | null> {
    if (auth.currentUser) return Promise.resolve(auth.currentUser)

    return new Promise((resolve) => {
        let unsubscribe = () => {}
        const timeout = window.setTimeout(() => {
            unsubscribe()
            resolve(auth.currentUser)
        }, timeoutMs)

        unsubscribe = onAuthStateChanged(auth, (user) => {
            window.clearTimeout(timeout)
            unsubscribe()
            resolve(user)
        })
    })
}

export async function requireMatchingFirebaseUser(localUser: LocalAuthIdentity | null): Promise<User> {
    const authUser = await waitForAuthUser()
    const localIds = [
        normalize(localUser?.id),
        normalize(localUser?.email),
        normalize(localUser?.uid),
    ].filter(Boolean)

    const authIds = [
        normalize(authUser?.email),
        normalize(authUser?.uid),
    ].filter(Boolean)

    const matches = !!authUser && authIds.some((authId) => localIds.includes(authId))

    if (!matches) {
        throw new Error(STALE_AUTH_SESSION_MESSAGE)
    }

    return authUser
}

export function getFirebaseUserId(user: User): string {
    return normalize(user.email) || user.uid
}

export function isStaleAuthSessionError(error: unknown): error is Error {
    return error instanceof Error && error.message === STALE_AUTH_SESSION_MESSAGE
}
