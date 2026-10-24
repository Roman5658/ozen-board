import assert from "node:assert/strict";
import test from "node:test";
import {
    deleteTelegramWebhook,
    getTelegramWebhookStatus,
    registerTelegramWebhook,
    requireTelegramAdmin,
} from "../functions/src/imports/telegramWebhookAdmin";
import { deactivateTelegramListingAsAdmin } from "../functions/src/imports/telegramListingLifecycle";

const BOT_TOKEN = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_123456789";
const WEBHOOK_SECRET = "test-webhook-secret_123456789";
const WEBHOOK_URL = "https://us-central1-demo-ozen-board-stage-61.cloudfunctions.net/telegramListingsWebhook";
const VERIFIED_ADMIN = { token: { email: "OZENENESIS56@GMAIL.COM", email_verified: true } };

function asCallableError(error: unknown): { code: string; message: string } {
    assert.ok(error !== null && typeof error === "object" && "code" in error && "message" in error);
    return error as { code: string; message: string };
}

test("Telegram webhook callables reject unauthenticated, unverified, and non-admin callers before network access", async () => {
    let calls = 0;
    const fetchImplementation: typeof fetch = async () => {
        calls++;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const authCases = [
        { auth: undefined, code: "unauthenticated" },
        { auth: { token: { email: "ozenenesis56@gmail.com", email_verified: false } }, code: "permission-denied" },
        { auth: { token: { email: "unlisted@example.test", email_verified: true } }, code: "permission-denied" },
    ] as const;

    for (const { auth, code } of authCases) {
        const registerError = asCallableError(await registerTelegramWebhook(auth, {
            botToken: BOT_TOKEN,
            webhookSecret: WEBHOOK_SECRET,
            webhookUrl: WEBHOOK_URL,
            fetchImplementation,
        }).catch((error: unknown) => error));
        assert.equal(registerError.code, code);

        const deleteError = asCallableError(await deleteTelegramWebhook(auth, {
            botToken: BOT_TOKEN,
            fetchImplementation,
        }).catch((error: unknown) => error));
        assert.equal(deleteError.code, code);

        const statusError = asCallableError(await getTelegramWebhookStatus(auth, {
            botToken: BOT_TOKEN,
            webhookUrl: WEBHOOK_URL,
            fetchImplementation,
        }).catch((error: unknown) => error));
        assert.equal(statusError.code, code);

        const deactivateError = asCallableError(await deactivateTelegramListingAsAdmin(
            auth,
            {} as never,
            "telegram-test-id",
            "original_removed",
        ).catch((error: unknown) => error));
        assert.equal(deactivateError.code, code);
    }
    assert.equal(calls, 0);
    assert.doesNotThrow(() => requireTelegramAdmin(VERIFIED_ADMIN));
});

test("register webhook sends the expected Bot API payload and returns no secret material", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
        requests.push({ url: String(input), init });
        if (String(input).endsWith("/getWebhookInfo")) {
            return new Response(JSON.stringify({ ok: true, result: { url: "", pending_update_count: 0 } }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    };

    const result = await registerTelegramWebhook(VERIFIED_ADMIN, {
        botToken: BOT_TOKEN,
        webhookSecret: WEBHOOK_SECRET,
        webhookUrl: WEBHOOK_URL,
        fetchImplementation,
    });

    assert.deepEqual(requests.map((request) => request.url), [
        `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`,
        `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
    ]);
    assert.deepEqual(JSON.parse(String(requests[1].init?.body)), {
        url: WEBHOOK_URL,
        secret_token: WEBHOOK_SECRET,
        allowed_updates: ["message", "channel_post", "edited_message", "edited_channel_post"],
        drop_pending_updates: false,
        max_connections: 5,
    });
    assert.deepEqual(result, { registered: true });
    assert.equal(JSON.stringify(result).includes(BOT_TOKEN), false);
    assert.equal(JSON.stringify(result).includes(WEBHOOK_SECRET), false);
});

test("register refuses to replace a different existing webhook", async () => {
    let calls = 0;
    const error = asCallableError(await registerTelegramWebhook(VERIFIED_ADMIN, {
        botToken: BOT_TOKEN,
        webhookSecret: WEBHOOK_SECRET,
        webhookUrl: WEBHOOK_URL,
        fetchImplementation: (async () => {
            calls++;
            return new Response(JSON.stringify({
                ok: true,
                result: { url: "https://other-service.example/telegram" },
            }), { status: 200 });
        }) as typeof fetch,
    }).catch((caught: unknown) => caught));
    assert.equal(error.code, "failed-precondition");
    assert.equal(calls, 1);
    assert.equal(error.message.includes(BOT_TOKEN), false);
    assert.equal(error.message.includes(WEBHOOK_SECRET), false);
});

test("delete webhook preserves pending updates and returns no token", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchImplementation: typeof fetch = async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    };

    const result = await deleteTelegramWebhook(VERIFIED_ADMIN, { botToken: BOT_TOKEN, fetchImplementation });

    assert.equal(requestUrl, `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
    assert.deepEqual(JSON.parse(String(requestInit?.body)), { drop_pending_updates: false });
    assert.deepEqual(result, { deleted: true });
    assert.equal(JSON.stringify(result).includes(BOT_TOKEN), false);
});

test("diagnostics expose getWebhookInfo state without returning URL, raw errors, or secrets", async () => {
    const privateUrl = "https://us-central1-secret-project.cloudfunctions.net/telegramListingsWebhook";
    const result = await getTelegramWebhookStatus(VERIFIED_ADMIN, {
        botToken: BOT_TOKEN,
        webhookUrl: WEBHOOK_URL,
        fetchImplementation: (async () => new Response(JSON.stringify({
            ok: true,
            result: {
                url: privateUrl,
                pending_update_count: 3,
                max_connections: 5,
                allowed_updates: ["message", "channel_post"],
                last_error_date: 1_800_000_000,
                last_error_message: `${BOT_TOKEN} ${WEBHOOK_SECRET}`,
            },
        }), { status: 200 })) as typeof fetch,
    });

    assert.deepEqual(result, {
        registered: true,
        configuredEndpointMatches: false,
        pendingUpdateCount: 3,
        maxConnections: 5,
        allowedUpdates: ["message", "channel_post"],
        lastErrorDate: 1_800_000_000,
    });
    assert.equal(JSON.stringify(result).includes(privateUrl), false);
    assert.equal(JSON.stringify(result).includes(BOT_TOKEN), false);
    assert.equal(JSON.stringify(result).includes(WEBHOOK_SECRET), false);
});

test("Telegram API, HTTP, malformed JSON, and transport errors are sanitized", async () => {
    const cases: Array<{ response: () => Promise<Response>; expectedMessage: string }> = [
        {
            response: async () => new Response(JSON.stringify({ ok: false, description: `bad ${BOT_TOKEN} ${WEBHOOK_SECRET}` }), { status: 200 }),
            expectedMessage: "Telegram rejected the webhook operation.",
        },
        {
            response: async () => new Response(JSON.stringify({ ok: true }), { status: 500 }),
            expectedMessage: "Telegram rejected the webhook operation.",
        },
        {
            response: async () => new Response("not json", { status: 200 }),
            expectedMessage: "Telegram rejected the webhook operation.",
        },
    ];

    for (const item of cases) {
        const error = asCallableError(await deleteTelegramWebhook(VERIFIED_ADMIN, {
            botToken: BOT_TOKEN,
            fetchImplementation: item.response as typeof fetch,
        }).catch((caught: unknown) => caught));
        assert.equal(error.code, "unavailable");
        assert.equal(error.message, item.expectedMessage);
        assert.equal(error.message.includes(BOT_TOKEN), false);
        assert.equal(error.message.includes(WEBHOOK_SECRET), false);
    }

    const transportError = asCallableError(await registerTelegramWebhook(VERIFIED_ADMIN, {
        botToken: BOT_TOKEN,
        webhookSecret: WEBHOOK_SECRET,
        webhookUrl: WEBHOOK_URL,
        fetchImplementation: (async () => { throw new Error(`${BOT_TOKEN} ${WEBHOOK_SECRET}`); }) as typeof fetch,
    }).catch((error: unknown) => error));
    assert.equal(transportError.code, "unavailable");
    assert.equal(transportError.message.includes(BOT_TOKEN), false);
    assert.equal(transportError.message.includes(WEBHOOK_SECRET), false);
});
