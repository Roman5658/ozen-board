export type AppUser = {
    id: string          // email (для совместимости c текущими ownerId/userId и ADMIN_IDS)
    uid: string         // Firebase Auth UID
    email: string
    nickname: string

    karma: number
    createdAt: number
    phone?: string | null
    telegram?: string | null
}
