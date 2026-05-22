export type UserReview = {
    id: string
    targetUserId: string
    targetUserName?: string
    authorUserId: string
    authorUserName?: string
    adId: string
    adTitle: string
    karmaValue: -1 | 1
    comment?: string
    role: 'seller' | 'buyer'
    createdAt: number
}