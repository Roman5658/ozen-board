export type LeadAudience = "pl" | "ua"
export type LeadCategory = "jobs" | "sales" | "services" | "rent" | "other"
export type LeadStatus = "new" | "wrote" | "replied" | "posted" | "rejected"

export type Lead = {
    id: string
    source: "olx"
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
