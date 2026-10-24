import assert from "node:assert/strict";
import test from "node:test";
import {
    isExternalListingsConfigEnabled,
    isTelegramExternalSource,
    isTelegramListingsConfigEnabled,
    shouldShowExternalSource,
} from "../src/utils/externalListingsVisibility";

test("external cards are visible only when the server config explicitly enables them", () => {
    assert.equal(isExternalListingsConfigEnabled({ enabled: true }), true);
    assert.equal(isExternalListingsConfigEnabled({ enabled: false }), false);
    assert.equal(isExternalListingsConfigEnabled(undefined), false);
    assert.equal(isExternalListingsConfigEnabled(null), false);
    assert.equal(isExternalListingsConfigEnabled({ enabled: "true" }), false);
    assert.equal(isExternalListingsConfigEnabled([]), false);
});

test("Telegram visibility requires both the shared and Telegram switches", () => {
    assert.equal(isTelegramListingsConfigEnabled({ enabled: true, telegramEnabled: true }), true);
    assert.equal(isTelegramListingsConfigEnabled({ enabled: true, telegramEnabled: false }), false);
    assert.equal(isTelegramListingsConfigEnabled({ enabled: false, telegramEnabled: true }), false);
    assert.equal(isTelegramListingsConfigEnabled({ enabled: true }), false);
    assert.equal(isTelegramListingsConfigEnabled(null), false);
});

test("disabling Telegram cards preserves other external sources", () => {
    const telegramSourceId = "telegram_0123456789abcdefabcd";
    assert.equal(isTelegramExternalSource(telegramSourceId), true);
    assert.equal(shouldShowExternalSource(telegramSourceId, false), false);
    assert.equal(shouldShowExternalSource(telegramSourceId, true), true);
    assert.equal(shouldShowExternalSource("partner_poland", false), true);
    assert.equal(isTelegramExternalSource("telegram_not-a-hash"), false);
});
