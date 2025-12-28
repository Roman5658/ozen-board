// src/data/localAuctions.ts
export type LocalAuction = {
    id: string;
    userId: string;
    title: string;
    description: string;
    category: string;
    voivodeship: string;
    city: string;

    createdAt: number;

    // auction-specific
    endsAt: number;
    startPrice: number;
    images: string[]; // URLs
};

const KEY = "ozen_board_auctions";

export function getLocalAuctions(): LocalAuction[] {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as LocalAuction[]) : [];
    } catch {
        return [];
    }
}

export function setLocalAuctions(auctions: LocalAuction[]) {
    localStorage.setItem(KEY, JSON.stringify(auctions));
}

export function addLocalAuction(auction: LocalAuction) {
    const auctions = getLocalAuctions();
    setLocalAuctions([auction, ...auctions]);
}

export function removeLocalAuction(id: string) {
    const auctions = getLocalAuctions();
    const next = auctions.filter((a) => String(a.id) !== String(id));
    setLocalAuctions(next);
}
