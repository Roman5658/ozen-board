export type Ad = {
    id: string
    title: string
    description: string
    category: "work" | "sell" | "buy" | "service" | "rent"
    voivodeship: string
    city: string
    price: string
    image?: string


    createdAt: number
    isPremium?: boolean
    userId: string
    sellerContact?: string

    location?: {
        lat: number
        lng: number
    }




}
