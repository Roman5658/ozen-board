const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTelegramUpdateFromCollectorPayload,
  hasExplicitTelegramCollectorSenderAllowlist,
} = require("../lib/imports/telegramCollectorAdapter.js");
const {
  isAuthorizedTelegramCollectorRequest,
  signTelegramCollectorBody,
  createTelegramCollectorUpdateKey,
} = require("../lib/imports/telegramCollectorSecurity.js");

const secret = "collector-test-secret-0123456789-abcdef";

function payload(overrides = {}) {
  return {
    version: 1,
    chat: { id: "-1001234567890", type: "supergroup", username: "public_test_group" },
    message: {
      id: 23,
      date: 1_800_000_000,
      text: "Synthetic test listing text",
      senderId: 8519508488,
      threadId: null,
      groupedId: null,
      photos: [],
      photoExpected: false,
      edited: false,
    },
    ...overrides,
  };
}

test("collector HMAC authenticates the exact body and rejects tampering and stale requests", () => {
  const timestamp = "1800000000";
  const body = Buffer.from('{"version":1}', "utf8");
  const signature = signTelegramCollectorBody(secret, timestamp, body);
  assert.equal(signature, "8dd160f9c45b3a41bc614f83a50c52c1e2157fd3cf8fc7fe3a4d4b890bff13f6");
  assert.equal(isAuthorizedTelegramCollectorRequest(secret, timestamp, signature, body, 1_800_000_000), true);
  assert.equal(isAuthorizedTelegramCollectorRequest(secret, timestamp, signature, Buffer.from("{}"), 1_800_000_000), false);
  assert.equal(isAuthorizedTelegramCollectorRequest(secret, timestamp, signature, body, 1_800_000_400), false);
  assert.equal(isAuthorizedTelegramCollectorRequest("short", timestamp, signature, body, 1_800_000_000), false);
});

test("collector envelope normalizes only server-controlled Telegram update fields", () => {
  const body = Buffer.from(JSON.stringify(payload()));
  const result = buildTelegramUpdateFromCollectorPayload(payload(), body, 1_800_000_001);
  assert.equal(result.update.message.chat.id, -1001234567890);
  assert.equal(result.update.message.from.id, 8519508488);
  assert.equal(result.photoUnavailable, false);
  assert.match(result.updateId, /^collector_[a-f0-9]{64}$/);
  assert.equal(createTelegramCollectorUpdateKey(body), result.updateId);
});

test("collector retries use a stable body key without changing Bot API update IDs", () => {
  const value = payload();
  const body = Buffer.from(JSON.stringify(value));
  const collector = buildTelegramUpdateFromCollectorPayload(value, body, 1_800_000_001);
  const retry = buildTelegramUpdateFromCollectorPayload(value, body, 1_800_000_001);
  assert.equal(collector.updateId, retry.updateId);
  assert.equal(collector.update.message.message_id, retry.update.message.message_id);
});

test("collector cannot spoof source, rights, trust, or publication decisions", () => {
  for (const key of ["trusted", "source", "autoPublish", "permissionConfirmed", "rightsFields", "status"]) {
    const value = payload();
    value.message[key] = true;
    assert.throws(() => buildTelegramUpdateFromCollectorPayload(value, Buffer.from(JSON.stringify(value)), 1_800_000_001));
  }
});

test("collector source requires an explicit non-empty sender allowlist", () => {
  assert.equal(hasExplicitTelegramCollectorSenderAllowlist({ allowedSenderIds: new Set(["8519508488"]) }), true);
  assert.equal(hasExplicitTelegramCollectorSenderAllowlist({ allowedSenderIds: new Set() }), false);
  assert.equal(hasExplicitTelegramCollectorSenderAllowlist({}), false);
});

test("collector validates chat, dates, and image bytes, while missing images force review", () => {
  const invalidChat = payload({ chat: { id: "-1009", type: "private", username: null } });
  assert.throws(() => buildTelegramUpdateFromCollectorPayload(invalidChat, Buffer.from(JSON.stringify(invalidChat)), 1_800_000_001));

  const invalidImage = payload();
  invalidImage.message.photoExpected = true;
  invalidImage.message.photos = ["not base64!"];
  assert.throws(() => buildTelegramUpdateFromCollectorPayload(invalidImage, Buffer.from(JSON.stringify(invalidImage)), 1_800_000_001));

  const unavailable = payload();
  unavailable.message.photoExpected = true;
  const result = buildTelegramUpdateFromCollectorPayload(unavailable, Buffer.from(JSON.stringify(unavailable)), 1_800_000_001);
  assert.equal(result.photoUnavailable, true);
  assert.equal(result.update.message.photo[0].file_id, "collector:media-unavailable");
});
