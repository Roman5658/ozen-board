
import type { AdPriceType } from "./adPrice";

export type AdPricingErrorCode =
    | "INVALID_PRICE_TYPE"
    | "PRICE_REQUIRED"
    | "PRICE_INVALID"
    | "PRICE_TOO_LONG"
    | "EXCHANGE_DETAILS_INVALID";

export class AdPricingValidationError extends Error {
    readonly code: AdPricingErrorCode;

    constructor(code: AdPricingErrorCode) {
        super(code);
        this.code = code;
        this.name = "AdPricingValidationError";
    }
}

export type AdPricingFields = {
    priceType: AdPriceType;
    price: string;
    exchangeDetails?: string;
};

const MAX_PRICE_LENGTH = 80;
const MAX_EXCHANGE_DETAILS_LENGTH = 200;

function isInvalidPriceText(value: string): boolean {
    const text = value.trim();

    if (/(^|[^a-z])(nan|[-+]?infinity)(?=$|[^a-z])/i.test(text)) {
        return true;
    }

    if (/(?:^|[^0-9])[-−]\s*\d+/i.test(text)) {
        return true;
    }

    if (/[0-9][eE][+-]?[0-9]+/.test(text)) {
        return true;
    }

    const numeric = text
        .replace(/\s*(?:zł|pln)\s*$/i, "")
        .replace(",", ".");

    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(numeric)) {
        const amount = Number(numeric);
        return !Number.isFinite(amount) || amount < 0;
    }

    return false;
}

/**
 * Shared by create and edit forms.
 * Paid listings may have an unknown price.
 * Switching to free or exchange clears stale prices.
 */
export function normalizeAdPricing(
    priceType: unknown,
    price: unknown,
    exchangeDetails: unknown,
): AdPricingFields {
    if (
        priceType !== "paid" &&
        priceType !== "free" &&
        priceType !== "exchange"
    ) {
        throw new AdPricingValidationError("INVALID_PRICE_TYPE");
    }

    if (priceType === "paid") {
        if (
            price === undefined ||
            price === null ||
            (typeof price === "string" && !price.trim())
        ) {
            throw new AdPricingValidationError("PRICE_REQUIRED");
        }

        if (typeof price !== "string") {
            throw new AdPricingValidationError("PRICE_INVALID");
        }

        const normalizedPrice = price.trim();

        if (normalizedPrice.length > MAX_PRICE_LENGTH) {
            throw new AdPricingValidationError("PRICE_TOO_LONG");
        }

        if (isInvalidPriceText(normalizedPrice)) {
            throw new AdPricingValidationError("PRICE_INVALID");
        }

        return { priceType, price: normalizedPrice };
    }

    if (priceType === "free") {
        return { priceType, price: "" };
    }

    if (
        exchangeDetails !== undefined &&
        exchangeDetails !== null &&
        typeof exchangeDetails !== "string"
    ) {
        throw new AdPricingValidationError("EXCHANGE_DETAILS_INVALID");
    }

    const normalizedDetails =
        typeof exchangeDetails === "string"
            ? exchangeDetails.trim()
            : "";

    if (normalizedDetails.length > MAX_EXCHANGE_DETAILS_LENGTH) {
        throw new AdPricingValidationError("EXCHANGE_DETAILS_INVALID");
    }

    return {
        priceType,
        price: "",
        ...(normalizedDetails ? { exchangeDetails: normalizedDetails } : {}),
    };
}
