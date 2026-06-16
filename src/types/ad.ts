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
    status?: "active" | "pending_payment" | "deleted" | "expired" | "hidden" | "removed"
    moderationReason?: string | null
    moderatedAt?: number | null
    moderatedBy?: string | null
    restoredAt?: number | null
    restoredBy?: string | null
    deletedAt?: number | null
    deletedBy?: string | null
    deleteReason?: string | null
    removedAt?: number | null
    removedBy?: string | null
    ownerNotificationStatus?: "unread" | "read" | null
    ownerNotificationMessage?: string | null
    adminViewedAt?: number | null
    adminViewedBy?: string | null
    // оплата и продвижение
    paidAt?: number
    paymentId?: string


    // ✅ новая модель
    images?: string[]

    createdAt: number
    userId: string
    userName?: string | null
    userNickname?: string | null
    sellerName?: string | null
    sellerNickname?: string | null
    nickname?: string | null
    ownerName?: string | null
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
