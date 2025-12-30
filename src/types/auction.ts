export type AuctionStatus = "active" | "ended"
export type AuctionPromotionType =
    | "none"
    | "top-auction"
    | "featured"
    | "highlight-gold"

export type AuctionBid = {
    id: string
    auctionId: string        // важно для связей
    userId: string
    userName: string
    amount: number
    createdAt: number
}

export type Auction = {
    id: string

    title: string
    description: string
    category: string
    voivodeship: string
    city: string

    startPrice: number
    buyNowPrice?: number
    currentBid: number

    images: string[]

    ownerId: string          // вместо userId (понятнее кто владелец)
    ownerName: string

    bidsCount: number         // чтобы быстро показывать в списке
    winnerId?: string | null  // появится после завершения
    status: AuctionStatus

    createdAt: number
    endsAt: number

    currentBidderId?: string | null
    currentBidderName?: string | null

    promotionType: AuctionPromotionType
    promotionUntil?: number | null

}

// Это тип ТОЛЬКО для страницы аукциона (когда мы подгрузили ставки отдельно)
export type AuctionWithBids = Auction & {
    bids: AuctionBid[]
}
