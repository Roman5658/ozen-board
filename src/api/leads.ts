import { getFunctions, httpsCallable } from "firebase/functions"
import { app } from "../app/firebase"
import type { LeadAudience, LeadCategory, LeadSource } from "../types/lead"

const functions = getFunctions(app)

export const importOlxLeads = httpsCallable<
    {
        searchUrl: string
        audience: LeadAudience
        category: LeadCategory
        city: string
        limit: number
    },
    {
        found: number
        imported: number
        duplicates: number
    }
>(functions, "importOlxLeads")

export const createManualLead = httpsCallable<
    {
        source: LeadSource
        audience: LeadAudience
        language: LeadAudience
        category: LeadCategory
        city: string
        title: string
        listingUrl: string
        contactUrl: string
        note: string
    },
    {
        created: boolean
        duplicate: boolean
        leadId: string
    }
>(functions, "createManualLead")
