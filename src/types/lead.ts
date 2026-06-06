export type LeadAudience = "pl" | "ua"
export type LeadSource = "olx" | "otomoto" | "allegro_lokalnie" | "manual" | "other"
export type LeadCategory = "jobs" | "sales" | "services" | "rent" | "other"
export type LeadStatus = "new" | "wrote" | "replied" | "posted" | "rejected"

export type Lead = {
    id: string
    source: LeadSource
    audience: LeadAudience
    language: LeadAudience
    category: LeadCategory
    city: string
    title: string
    listingUrl: string
    contactUrl: string
    status: LeadStatus
    note: string
    createdAt: number
}
