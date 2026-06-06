import { getFunctions, httpsCallable } from "firebase/functions"
import { app } from "../app/firebase"
import type { LeadAudience, LeadCategory } from "../types/lead"

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
