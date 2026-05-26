export type AppUser = {
    id: string          // email (для совместимости c текущими ownerId/userId и ADMIN_IDS)
    uid: string         // Firebase Auth UID
    email: string
    nickname: string
    status?: "active" | "blocked"
    blockedAt?: number | null
    blockedReason?: string | null
    blockedBy?: string | null

    karma: number
    createdAt: number
    phone?: string | null
    telegram?: string | null
}
