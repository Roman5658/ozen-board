import type { AppUser } from "../types/user"
import { ADMIN_IDS } from "../admin/adminIds"

const KEY = "ozen_user"
export const LOCAL_USER_CHANGED_EVENT = "ozen-user-changed"

function notifyLocalUserChanged() {
    window.dispatchEvent(new Event(LOCAL_USER_CHANGED_EVENT))
}

export function getLocalUser(): AppUser | null {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as AppUser) : null
}

export function setLocalUser(user: AppUser) {
    localStorage.setItem(KEY, JSON.stringify(user))
    notifyLocalUserChanged()
}

export function clearLocalUser() {
    localStorage.removeItem(KEY)
    notifyLocalUserChanged()
}

export function isAdmin(): boolean {
    const user = getLocalUser()
    if (!user) return false
    return ADMIN_IDS.includes(user.id) || ADMIN_IDS.includes(user.email)
}
