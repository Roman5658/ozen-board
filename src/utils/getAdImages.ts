import type { Ad } from "../types/ad";

export function getAdImages(ad: Ad): string[] {
    if (Array.isArray(ad.images) && ad.images.length > 0) {
        return ad.images;
    }
    if (ad.image) {
        return [ad.image];
    }
    return [];
}
