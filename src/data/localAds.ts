import type { Ad } from "../types/ad";

const STORAGE_KEY = "ozen_ads";

export function getLocalAds(): Ad[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

export function addLocalAd(ad: Ad) {
    const current = getLocalAds();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([ad, ...current]));
}
export function removeLocalAd(id: string) {
    const ads = getLocalAds().filter(ad => ad.id !== id)
    localStorage.setItem("ads", JSON.stringify(ads))
}


