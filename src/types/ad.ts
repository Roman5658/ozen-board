import type { Category } from './category'

export type Ad = {
    id: number
    title: string
    description?: string
    city?: string
    voivodeship?: string
    category: Category
    price?: string
    isPremium?: boolean
    image?: string
    userId?: string
    createdAt: number
    location?: {
        lat: number
        lng: number
    }
}
