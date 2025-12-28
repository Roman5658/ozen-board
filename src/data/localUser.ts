import type { AppUser } from "../types/user"

const KEY = "ozen_user"

export function getLocalUser(): AppUser | null {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as AppUser) : null
}

export function setLocalUser(user: AppUser) {
    localStorage.setItem(KEY, JSON.stringify(user))
}

export function clearLocalUser() {
    localStorage.removeItem(KEY)
}
