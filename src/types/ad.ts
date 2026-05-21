export type Ad = {
    id: string
    title: string
    description: string
    category: "work" | "sell" | "buy" | "service" | "rent"
    voivodeship: string
    city: string
    address?: string
    price: string

    // 🔁 legacy (ПОКА)
    image?: string
    isPremium?: boolean
    isPinned?: boolean
    status?: "active" | "deleted" | "expired"
    // оплата и продвижение
    paidAt?: number
    paymentId?: string


    // ✅ новая модель
    images?: string[]

    createdAt: number
    userId: string
    sellerContact?: string

    location?: {
        lat: number
        lng: number
    }

    // 🔥 ФИНАЛЬНАЯ МОДЕЛЬ ПРИОРИТЕТОВ
    pinType?: "top3" | "top6"
    pinnedAt?: number
    pinnedUntil?: number
    pinQueueAt?: number


    bumpAt?: number

    highlightType?: "gold" | "blue"
    highlightUntil?: number
}
