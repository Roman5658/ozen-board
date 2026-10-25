import { formatPricePLN } from "./formatPricePLN";

export type AdPriceType = "paid" | "free" | "exchange";

export type AdPriceLabels = {
    free: string;
    exchange: string;
    priceOnRequest: string;
};

export function isAdPriceType(value: unknown): value is AdPriceType {
    return value === "paid" || value === "free" || value === "exchange";
}

/** Legacy listings have no priceType and keep their existing paid-price behavior. */
export function resolveAdPriceType(value: unknown): AdPriceType {
    return isAdPriceType(value) ? value : "paid";
}

export function getAdPriceLabel(
    priceType: unknown,
    price: unknown,
    labels: AdPriceLabels,
): string {
    switch (resolveAdPriceType(priceType)) {
        case "free":
            return labels.free;
        case "exchange":
            return labels.exchange;
        case "paid": {
            if (typeof price !== "string" && typeof price !== "number") {
                return labels.priceOnRequest;
            }
            if (typeof price === "number" && !Number.isFinite(price)) return "";
            const raw = String(price).trim();
            if (!raw) return labels.priceOnRequest;
            if (/(^|[^a-z])(nan|[-+]?infinity)(?=$|[^a-z])/i.test(raw)) {
                return "";
            }
            if (/(?:^|[^0-9])[-−]\s*\d+/i.test(raw)) return "";
            if (/[0-9][eE][+-]?[0-9]+/.test(raw)) return "";
            return formatPricePLN(raw);
        }
    }
}
