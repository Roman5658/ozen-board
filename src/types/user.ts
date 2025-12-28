export type AppUser = {
    id: string          // authId (в будущем uid от Firebase Auth)
    email: string
    nickname: string
    password?: string   // ⚠️ временно, потом уберём
    karma: number
    createdAt: number
}
