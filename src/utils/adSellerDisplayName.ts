import type { Ad } from "../types/ad"

function cleanDisplayName(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined

    const trimmed = value.trim()
    return trimmed || undefined
}

export function getAdSellerDisplayName(ad?: Ad | null): string | undefined {
    if (!ad) return undefined

    return (
        cleanDisplayName(ad.userNickname) ||
        cleanDisplayName(ad.userName) ||
        cleanDisplayName(ad.sellerNickname) ||
        cleanDisplayName(ad.sellerName) ||
        cleanDisplayName(ad.nickname) ||
        cleanDisplayName(ad.ownerName)
    )
}
