import type { Auction } from '../types/auction'

const STORAGE_KEY = 'ozen_auctions'

export function getLocalAuctions(): Auction[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        return raw ? JSON.parse(raw) : []
    } catch {
        return []
    }
}

export function addLocalAuction(auction: Auction) {
    const current = getLocalAuctions()
    localStorage.setItem(STORAGE_KEY, JSON.stringify([auction, ...current]))
}
