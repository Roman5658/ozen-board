import { getDistanceKm } from "./distance";

export type GeoPoint = { lat: number; lng: number };
type LocatedRecord = { location?: GeoPoint | null };

function isValidGeoPoint(point: GeoPoint | null | undefined): point is GeoPoint {
    return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng) &&
        point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180;
}

export function getAdsWithinRadius<T extends LocatedRecord>(
    ads: readonly T[],
    userPosition: GeoPoint,
    radiusKm: number,
): Array<T & { distance: number }> {
    if (!isValidGeoPoint(userPosition) || !Number.isFinite(radiusKm) || radiusKm < 0) return [];

    return ads.flatMap((ad) => {
        if (!isValidGeoPoint(ad.location)) return [];
        const distance = getDistanceKm(userPosition.lat, userPosition.lng, ad.location.lat, ad.location.lng);
        return distance <= radiusKm ? [{ ...ad, distance }] : [];
    });
}
