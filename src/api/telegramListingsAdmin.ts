import { getFunctions, httpsCallable } from "firebase/functions"
import { app } from "../app/firebase"

export type TelegramWebhookStatus = {
    registered: boolean
    configuredEndpointMatches: boolean
    pendingUpdateCount: number | null
    maxConnections: number | null
    allowedUpdates: string[]
    lastErrorDate: number | null
}

const functions = getFunctions(app)

const getWebhookStatus = httpsCallable<void, TelegramWebhookStatus>(
    functions,
    "getTelegramListingsWebhookStatus",
)

const registerWebhook = httpsCallable<void, { registered: true }>(
    functions,
    "registerTelegramListingsWebhook",
)

export type TelegramModerationCandidate = {
    title: string
    description: string
    category: string
    catalogCategory: string
    catalogSubcategory: string
    priceType: string
    price: string
    exchangeDetails: string
    city: string
    voivodeship: string
    sellerContact: string
    images: string[]
}

export type TelegramModerationItem = {
    id: string
    expectedContentHash: string
    state: "pending_review" | "published"
    sourceUrl: string
    receivedAt: number
    reviewReasons: string[]
    candidate: TelegramModerationCandidate
    isPublishedEdit: boolean
}

const listModerationItems = httpsCallable<void, TelegramModerationItem[]>(functions, "listTelegramListingsForModeration")
const moderateListing = httpsCallable<{
    id: string
    expectedContentHash: string
    action: "approve" | "reject"
    ad?: Omit<TelegramModerationCandidate, "images"> & { catalogCategory?: string; catalogSubcategory?: string }
    reason?: string
}, { approved?: true; adId?: string; rejected?: true; rejectedEdit?: true }>(functions, "moderateTelegramListing")

/** Firebase Auth credentials are attached by the SDK; the callable enforces admin access. */
export async function getTelegramListingsWebhookStatus(): Promise<TelegramWebhookStatus> {
    return (await getWebhookStatus()).data
}

/** Registration is only called from an explicit admin action in the UI. */
export async function registerTelegramListingsWebhook(): Promise<void> {
    await registerWebhook()
}

export async function getTelegramListingsForModeration(): Promise<TelegramModerationItem[]> {
    return (await listModerationItems()).data
}

export async function moderateTelegramListing(input: Parameters<typeof moderateListing>[0]): Promise<void> {
    await moderateListing(input)
}
