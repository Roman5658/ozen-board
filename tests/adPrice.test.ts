import assert from "node:assert/strict";
import test from "node:test";
import { getAdPriceLabel, resolveAdPriceType } from "../src/utils/adPrice.ts";
import { AdPricingValidationError, normalizeAdPricing as normalizeFormPricing } from "../src/utils/adPricing.ts";
import { InvalidAdPricingError, normalizeAdPricing as normalizeServerPricing } from "../functions/src/listings/adPricing.ts";
import { getTrustedAdSellerName } from "../functions/src/listings/adIdentity.ts";
import { buildTrustedTelegramAdData } from "../functions/src/listings/createAd.ts";

const labels = {
    paid: "Płatne",
    free: "Za darmo",
    exchange: "Wymiana",
    priceOnRequest: "Cena u właściciela",
};

test("old listings without a price type remain paid", () => {
    assert.equal(resolveAdPriceType(undefined), "paid");
    assert.equal(getAdPriceLabel(undefined, "125", labels), "125 zł");
});

test("free and exchange listings ignore stale stored prices", () => {
    assert.equal(getAdPriceLabel("free", "900 zł", labels), "Za darmo");
    assert.equal(getAdPriceLabel("exchange", "900 zł", labels), "Wymiana");
});

test("paid listings preserve existing formatting and suppress invalid values", () => {
    assert.equal(getAdPriceLabel("paid", "25 zł/год", labels), "25 zł/год");
    assert.equal(getAdPriceLabel("paid", "NaN", labels), "");
    assert.equal(getAdPriceLabel("paid", "-5", labels), "");
    assert.equal(getAdPriceLabel("paid", "-Infinity", labels), "");
    assert.equal(getAdPriceLabel("paid", "1e999", labels), "");
    assert.equal(getAdPriceLabel("paid", Number.NaN, labels), "");
    assert.equal(getAdPriceLabel("paid", "", labels), "Cena u właściciela");
    assert.equal(getAdPriceLabel("paid", undefined, labels), "Cena u właściciela");
    assert.equal(getAdPriceLabel("paid", "", { ...labels, priceOnRequest: "Ціна у власника" }), "Ціна у власника");
});


test("ordinary paid ad creation requires a price by default; legacy requests still default to paid", () => {
    assert.deepEqual(normalizeServerPricing(undefined, " 125 ", undefined), {
        priceType: "paid",
        price: "125",
    });

    assert.deepEqual(normalizeFormPricing("paid", " 25 zł/год ", ""), {
        priceType: "paid",
        price: "25 zł/год",
    });

    for (const missing of [undefined, null, "", "   "]) {
        assert.throws(() => normalizeServerPricing("paid", missing, undefined), InvalidAdPricingError);
        assert.throws(() => normalizeServerPricing(undefined, missing, undefined), InvalidAdPricingError);
        assert.throws(() => normalizeFormPricing("paid", missing, undefined), AdPricingValidationError);
    }
});

test("trusted Telegram ad construction explicitly allows a paid ad with no price", () => {
    assert.deepEqual(normalizeServerPricing("paid", "", undefined, { allowEmptyPaidPrice: true }), {
        priceType: "paid",
        price: "",
    });
    assert.deepEqual(normalizeServerPricing("paid", null, undefined, { allowEmptyPaidPrice: true }), {
        priceType: "paid",
        price: "",
    });
    const ad = buildTrustedTelegramAdData({
        title: "Synthetic Telegram listing",
        description: "Synthetic description for trusted import normalization.",
        category: "sell",
        voivodeship: "Mazowieckie",
        city: "Warszawa",
        priceType: "paid",
        price: "",
    }, Date.now());
    assert.equal(ad.priceType, "paid");
    assert.equal(ad.price, "");
    assert.equal(ad.sourceType, "telegram");
});



test("free ad creation and editing discard an old price", () => {
    const expected = { priceType: "free", price: "" };
    assert.deepEqual(normalizeServerPricing("free", "999 zł", undefined), expected);
    assert.deepEqual(normalizeFormPricing("free", "999 zł", "old exchange details"), expected);
});

test("exchange ad creation includes optional details and always clears price", () => {
    const normalized = { priceType: "exchange", price: "", exchangeDetails: "велосипед" };
    assert.deepEqual(normalizeServerPricing("exchange", "500", " велосипед "), normalized);
    assert.deepEqual(normalizeFormPricing("exchange", "500", " велосипед "), normalized);
    assert.deepEqual(normalizeServerPricing("exchange", "500", undefined), {
        priceType: "exchange",
        price: "",
    });
    assert.deepEqual(normalizeFormPricing("exchange", "500", ""), {
        priceType: "exchange",
        price: "",
    });
});



test("create and edit reject malformed, negative, non-finite, and wrongly typed prices", () => {
    for (const invalid of [
        25,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        "NaN",
        "Infinity",
        "-Infinity",
        "-5",
        "−5 zł",
        "1e999",
        "25e3",
        "x".repeat(81),
    ]) {
        assert.throws(
            () => normalizeServerPricing("paid", invalid, undefined),
            InvalidAdPricingError,
        );
        assert.throws(
            () => normalizeServerPricing("paid", invalid, undefined, { allowEmptyPaidPrice: true }),
            InvalidAdPricingError,
        );
        assert.throws(
            () => normalizeFormPricing("paid", invalid, undefined),
            AdPricingValidationError,
        );
    }

    assert.throws(
        () => normalizeServerPricing("discount", "25", undefined),
        InvalidAdPricingError,
    );
});



test("all three edit price types use the same normalization as creation", () => {
    assert.deepEqual(normalizeFormPricing("paid", "25", undefined), {
        priceType: "paid",
        price: "25",
    });
    assert.deepEqual(normalizeFormPricing("free", "25", undefined), {
        priceType: "free",
        price: "",
    });
    assert.deepEqual(normalizeFormPricing("exchange", "25", ""), {
        priceType: "exchange",
        price: "",
    });
});

test("ad seller identity ignores client-supplied names and rejects reserved legacy names", () => {
    assert.equal(getTrustedAdSellerName("  trustedNick ", "buyer@example.com"), "trustedNick");
    assert.equal(getTrustedAdSellerName(null, "buyer@example.com"), "buyer");
    assert.equal(getTrustedAdSellerName("Xoven Admin", "buyer@example.com"), "buyer");
    assert.equal(getTrustedAdSellerName("XоvenAdmin", "xoven_admin@example.com"), "User");
    assert.equal(getTrustedAdSellerName(null, null), "User");
});
