export type LocalUser = {
    id: number
    name: string
    email: string
    karma: number
    createdAt: number
}


const KEY = 'ozen_user'

export function getLocalUser(): LocalUser | null {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
}

export function setLocalUser(user: LocalUser) {
    localStorage.setItem(KEY, JSON.stringify(user))
}

export function clearLocalUser() {
    localStorage.removeItem(KEY)
}
