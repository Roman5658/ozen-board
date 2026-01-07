// src/utils/canEdit.ts

import type { Ad } from "../types/ad"
import type { Auction } from "../types/auction"

// ======================
// ОБЪЯВЛЕНИЯ
// ======================
export function canEditAd(ad: Ad | null, userId: string | null): boolean {
    if (!ad || !userId) return false

    // только владелец
    if (String(ad.userId) !== String(userId)) return false

    // нельзя редактировать удалённые / завершённые
    if (ad.status === "deleted") return false
    if (ad.status === "expired") return false

    return true
}

// ======================
// АУКЦИОНЫ
// ======================
export function canEditAuction(
    auction: Auction | null,
    userId: string | null
): boolean {
    if (!auction || !userId) return false

    // только владелец
    if (String(auction.ownerId) !== String(userId)) return false

    // только draft / active
    if (!["draft", "active"].includes(auction.status)) return false

    // после ставок редактировать нельзя
    if (auction.bidsCount && auction.bidsCount > 0) return false

    return true
}
