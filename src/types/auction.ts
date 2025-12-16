export type Auction = {
    id: number
    title: string
    description: string
    category: string
    voivodeship: string
    city: string

    startPrice: number
    buyNowPrice?: number
    endsAt: number

    images: string[]
    userId: number
    createdAt: number
}
