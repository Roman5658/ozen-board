export type Report = {
    id: string
    adId: string
    adTitle: string
    reportedUserId: string
    reporterUserId?: string
    message: string
    createdAt: number
    status: 'new' | 'resolved'
}
