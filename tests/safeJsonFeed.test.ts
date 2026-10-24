import assert from "node:assert/strict";
import test from "node:test";
import {
    isPublicFeedAddress,
    parseSafeJsonResponse,
    SafeFeedError,
    validateSafeFeedEndpoint,
} from "../functions/src/imports/safeJsonFeed";

test("feed endpoint must be HTTPS on an exact reviewed hostname", () => {
    assert.equal(validateSafeFeedEndpoint("https://feed.vendor.example/v1/listings", ["feed.vendor.example"]).hostname, "feed.vendor.example");
    for (const value of [
        "http://feed.vendor.example/listings",
        "https://attacker.example/listings",
        "https://user:password@feed.vendor.example/listings",
        "https://feed.vendor.example:444/listings",
        "https://127.0.0.1/feed",
        "https://localhost/feed",
    ]) {
        assert.throws(() => validateSafeFeedEndpoint(value, ["feed.vendor.example"]), SafeFeedError);
    }
});

test("DNS destinations reject private and special IP ranges", () => {
    for (const address of [
        "0.0.0.1", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1",
        "172.16.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1", "203.0.113.1",
        "224.0.0.1", "::", "::1", "fc00::1", "fd00::1", "fe80::1", "ff02::1",
        "::ffff:127.0.0.1", "2001:db8::1", "2001:100::1", "2001:2::1", "2002:7f00:1::1",
        "3ffe::1", "3fff::1",
    ]) {
        assert.equal(isPublicFeedAddress(address), false, address);
    }
    assert.equal(isPublicFeedAddress("8.8.8.8"), true);
    assert.equal(isPublicFeedAddress("2606:4700:4700::1111"), true);
    assert.equal(isPublicFeedAddress("2001:4860:4860::8888"), true);
});

test("response parsing rejects redirects, non-JSON content and oversized responses", () => {
    const body = Buffer.from('{"items":[]}');
    assert.deepEqual(parseSafeJsonResponse(200, { "content-type": "application/json; charset=utf-8" }, body), { items: [] });
    assert.throws(() => parseSafeJsonResponse(302, { "content-type": "application/json" }, body), /feed-redirect-rejected/);
    assert.throws(() => parseSafeJsonResponse(200, { "content-type": "text/html" }, body), /feed-content-type-rejected/);
    assert.throws(() => parseSafeJsonResponse(200, { "content-type": "application/json" }, body, 4), /feed-response-too-large/);
    assert.throws(() => parseSafeJsonResponse(200, { "content-type": "application/json", "content-length": "999" }, body, 10), /feed-response-too-large/);
    assert.throws(() => parseSafeJsonResponse(200, { "content-type": "application/json" }, Buffer.from("not-json")), /feed-invalid-json/);
});
