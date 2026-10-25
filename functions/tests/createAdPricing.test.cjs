const assert = require("node:assert/strict");
const test = require("node:test");
const { createAd } = require("../lib/listings/createAd.js");

test("direct callable invocation cannot bypass the paid-price requirement with client source fields", async () => {
    await assert.rejects(
        createAd.run({
            auth: { uid: "synthetic-ordinary-user", token: {} },
            data: {
                title: "Synthetic ordinary listing",
                description: "Synthetic description for the callable validation test.",
                category: "sell",
                voivodeship: "Mazowieckie",
                city: "Warszawa",
                priceType: "paid",
                price: "",
                source: "telegram",
                sourceType: "telegram",
                userId: "telegram_import",
            },
        }),
        (error) => error && error.code === "invalid-argument",
    );
});
