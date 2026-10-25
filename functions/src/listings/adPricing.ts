export type AdPriceType = "paid" | "free" | "exchange";

export type AdPricingFields = {
    priceType: AdPriceType;
    price: string;
    exchangeDetails?: string;
};

export class InvalidAdPricingError extends Error {
    constructor() {
        super("Invalid ad pricing.");
        this.name = "InvalidAdPricingError";
    }
}

function isInvalidPriceText(value: string): boolean {
    const text = value.trim();
    if (/(^|[^a-z])(nan|[-+]?infinity)(?=$|[^a-z])/i.test(text)) return true;
    if (/(?:^|[^0-9])[-−]\s*\d+/i.test(text)) return true;
    if (/[0-9][eE][+-]?[0-9]+/.test(text)) return true;

    const numeric = text.replace(/\s*(?:zł|pln)\s*$/i, "").replace(",", ".");
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(numeric)) {
        const amount = Number(numeric);
        return !Number.isFinite(amount) || amount < 0;
    }

    return false;
}

/** Server-side normalization for createAd; non-paid types discard any submitted price. */

export function normalizeAdPricing(
    priceType: unknown,
    price: unknown,
    exchangeDetails: unknown,
    options: { allowEmptyPaidPrice?: boolean } = {},
): AdPricingFields {
    if (priceType === undefined || priceType === "paid") {
        if (price === undefined || price === null || (typeof price === "string" && !price.trim())) {
            if (!options.allowEmptyPaidPrice) throw new InvalidAdPricingError();
            return { priceType: "paid", price: "" };
        }

        if (typeof price !== "string") {
            throw new InvalidAdPricingError();
        }

        const normalizedPrice = price.trim();

        if (normalizedPrice.length > 80 || isInvalidPriceText(normalizedPrice)) {
            throw new InvalidAdPricingError();
        }

        return { priceType: "paid", price: normalizedPrice };
    }

    if (priceType === "free") {
        return { priceType, price: "" };
    }

    if (priceType !== "exchange") {
        throw new InvalidAdPricingError();
    }

    if (
        exchangeDetails !== undefined &&
        exchangeDetails !== null &&
        typeof exchangeDetails !== "string"
    ) {
        throw new InvalidAdPricingError();
    }

    const normalizedDetails =
        typeof exchangeDetails === "string" ? exchangeDetails.trim() : "";

    if (normalizedDetails.length > 200) {
        throw new InvalidAdPricingError();
    }

    return {
        priceType,
        price: "",
        ...(normalizedDetails ? { exchangeDetails: normalizedDetails } : {}),
    };
}
