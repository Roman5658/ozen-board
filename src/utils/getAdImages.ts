import type { Ad } from "../types/ad";
import type { SyntheticEvent } from "react";
import defaultListingImage from "../assets/default-listing.png";

export function getAdImages(ad: Ad): string[] {
    const storedImages = getStoredAdImages(ad);
    return storedImages.length > 0 ? storedImages : [defaultListingImage];
}

export function getStoredAdImages(ad: Pick<Ad, "images" | "image">): string[] {
    return getListingImages(ad.images, ad.image, false);
}

export function getListingImages(
    images?: string[],
    legacyImage?: string,
    includeFallback = true,
): string[] {
    const validImages = Array.isArray(images)
        ? images.filter((image): image is string => typeof image === "string" && image.trim().length > 0)
        : [];

    if (validImages.length > 0) return validImages;
    if (legacyImage?.trim()) return [legacyImage];

    return includeFallback ? [defaultListingImage] : [];
}

export function handleListingImageError(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    const fallbackUrl = new URL(defaultListingImage, window.location.href).href;
    if (image.src === fallbackUrl) return;

    image.src = defaultListingImage;
}
