import type { AppUser } from "../types/user"
import { ADMIN_IDS } from "../admin/adminIds"

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

export function isAdmin(): boolean {
    const user = getLocalUser()
    if (!user) return false
    return ADMIN_IDS.includes(user.id)
}
