import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExternalListing } from "../functions/src/imports/externalListings";
import {
    createTelegramMessageAdapter,
    getTelegramListingSkipReason,
    getTelegramUpdateChatId,
    getTelegramUpdateId,
    isTelegramListingsCatalogEnabled,
    isTelegramListingsEnabled,
    loadTelegramListingsConfig,
    lookupTelegramChatSource,
    mapTelegramMessageCandidate,
} from "../functions/src/imports/telegramListingsAdapter";
import { isAuthorizedTelegramWebhookSecret } from "../functions/src/imports/telegramWebhookSecurity";
import type { TelegramUpdateClaimStatus, TelegramUpdateLedger } from "../functions/src/imports/telegramUpdateLedger";

const chatId = "-1001234567890";
const chatConfig = {
    displayName: "Configured synthetic channel",
    publicUsername: "xoven_test_channel",
    chatType: "supergroup",
    allowedSenderIds: ["123456789"],
    rightsReference: "https://xoven.example/terms/syndication",
    rightsReviewedAt: 1_800_000_000_000,
    permissionConfirmed: true,
    autoPublish: true,
    maxUpdatesPerMinute: 5,
    rightsFields: ["title", "originalUrl", "description", "price", "category", "publishedAt"],
    categoryMappings: {
        electronics: { category: "sell", catalogCategory: "electronics", catalogSubcategory: "phonesComputers" },
    },
};
const baseEnv = {
    EXTERNAL_LISTINGS_ENABLED: "true",
    TELEGRAM_LISTINGS_ENABLED: "true",
    TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED: "true",
    TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({ [chatId]: chatConfig }),
};
const publishedAt = Math.floor(Date.now() / 1000) - 60;

function message(text: string, overrides: Record<string, unknown> = {}) {
    return {
        message_id: 42,
        date: publishedAt,
        chat: { id: Number(chatId), type: "supergroup", username: chatConfig.publicUsername },
        from: { id: 123456789, is_bot: false },
        text,
        ...overrides,
    };
}

function configuredChat() {
    const config = loadTelegramListingsConfig(baseEnv);
    assert.ok(config);
    const source = config.chats.get(chatId);
    assert.ok(source);
    return source;
}

test("the independent Telegram import switch preserves legacy defaults and external catalog visibility", () => {
    assert.equal(isTelegramListingsEnabled({ TELEGRAM_LISTINGS_ENABLED: "true" }), false);
    assert.equal(isTelegramListingsEnabled(baseEnv), true);
    assert.equal(isTelegramListingsEnabled({ ...baseEnv, TELEGRAM_LISTINGS_ENABLED: "false" }), false);
    assert.equal(isTelegramListingsEnabled({
        ...baseEnv,
        EXTERNAL_LISTINGS_ENABLED: "false",
        TELEGRAM_LISTINGS_ENABLED: "false",
        TELEGRAM_LISTINGS_IMPORT_ENABLED: "true",
    }), true);
    assert.equal(isTelegramListingsEnabled({
        ...baseEnv,
        TELEGRAM_LISTINGS_IMPORT_ENABLED: "false",
    }), false);
    assert.throws(() => isTelegramListingsEnabled({
        ...baseEnv,
        TELEGRAM_LISTINGS_IMPORT_ENABLED: "yes",
    }), /invalid-telegram-import-switch/);

    const independentConfig = loadTelegramListingsConfig({
        ...baseEnv,
        EXTERNAL_LISTINGS_ENABLED: "false",
        TELEGRAM_LISTINGS_ENABLED: "false",
        TELEGRAM_LISTINGS_IMPORT_ENABLED: "true",
        TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED: "false",
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
            [chatId]: { ...chatConfig, autoPublish: false },
        }),
    });
    assert.ok(independentConfig);
    assert.equal(independentConfig.chats.get(chatId)?.autoPublish, false);
    assert.equal(loadTelegramListingsConfig({
        ...baseEnv,
        TELEGRAM_LISTINGS_IMPORT_ENABLED: "false",
    }), null);

    assert.equal(isTelegramListingsCatalogEnabled({
        EXTERNAL_LISTINGS_ENABLED: "false",
        TELEGRAM_LISTINGS_ENABLED: "false",
        TELEGRAM_LISTINGS_IMPORT_ENABLED: "true",
    }), false);
    assert.equal(isTelegramListingsCatalogEnabled({
        EXTERNAL_LISTINGS_ENABLED: "true",
        TELEGRAM_LISTINGS_ENABLED: "true",
        TELEGRAM_LISTINGS_IMPORT_ENABLED: "false",
    }), true);
});

test("the configured Xoven test group accepts only its stated author and chat type", () => {
    const testChatId = "-1003976934887";
    const testUsername = "xoven_test_listings";
    const testSenderId = "8519508488";
    const config = loadTelegramListingsConfig({
        EXTERNAL_LISTINGS_ENABLED: "false",
        TELEGRAM_LISTINGS_ENABLED: "false",
        TELEGRAM_LISTINGS_IMPORT_ENABLED: "true",
        TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED: "false",
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
            [testChatId]: {
                displayName: `@${testUsername}`,
                publicUsername: testUsername,
                chatType: "supergroup",
                allowedSenderIds: [testSenderId],
                rightsReference: "https://t.me/xoven_test_listings",
                rightsReviewedAt: 1_800_000_000_000,
                permissionConfirmed: true,
                rightsFields: ["title", "originalUrl", "description"],
                autoPublish: false,
                maxUpdatesPerMinute: 5,
                categoryMappings: {},
            },
        }),
    });
    assert.ok(config);
    const source = config.chats.get(testChatId);
    assert.ok(source);
    assert.equal(source.autoPublish, false);
    assert.equal(source.maxUpdatesPerMinute, 5);

    const testMessage = {
        message_id: 1,
        date: publishedAt,
        chat: { id: Number(testChatId), type: "supergroup", username: testUsername },
        from: { id: Number(testSenderId), is_bot: false },
        text: "Synthetic test bicycle listing\nThis is a synthetic post by the owner for importer testing.",
    };
    const candidate = mapTelegramMessageCandidate(testMessage, source);
    assert.equal(candidate.originalUrl, `https://t.me/${testUsername}/1`);
    assert.equal(candidate.requiresReview, true);
    assert.throws(() => mapTelegramMessageCandidate({
        ...testMessage,
        from: { id: 123456789, is_bot: false },
    }, source), /unapproved-telegram-sender/);
    assert.throws(() => mapTelegramMessageCandidate({
        ...testMessage,
        chat: { ...testMessage.chat, type: "group" },
    }, source), /telegram-chat-type-mismatch/);
    assert.throws(() => mapTelegramMessageCandidate({
        ...testMessage,
        chat: { ...testMessage.chat, id: -1000000000000 },
    }, source), /unapproved-telegram-chat/);
});

test("Telegram chat source lookup reports missing or invalid IDs separately from IDs outside the allowlist", () => {
    const chats = new Map([[chatId, configuredChat()]]);

    assert.equal(getTelegramUpdateChatId({ message: { chat: { id: "not-a-chat-id" } } }), undefined);
    assert.deepEqual(lookupTelegramChatSource(undefined, chats), {
        found: false,
        reason: "chat_id_missing_or_invalid",
    });
    assert.deepEqual(lookupTelegramChatSource("-1009876543210", chats), {
        found: false,
        reason: "chat_id_not_allowlisted",
    });
    assert.deepEqual(lookupTelegramChatSource(chatId, chats), {
        found: true,
        source: configuredChat(),
    });
});

test("the reported multiline Xoven post parses from message.text and channel_post.text", async () => {
    const testChatId = "-1003976934887";
    const testEnv = {
        ...baseEnv,
        TELEGRAM_LISTINGS_IMPORT_ENABLED: "true",
        TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED: "false",
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
            [testChatId]: {
                displayName: "@xoven_test_listings",
                publicUsername: "xoven_test_listings",
                chatType: "supergroup",
                allowedSenderIds: ["8519508488"],
                rightsReference: "https://xoven.example/test-rights",
                rightsReviewedAt: 1_800_000_000_000,
                permissionConfirmed: true,
                rightsFields: ["title", "originalUrl", "description", "price", "category", "publishedAt"],
                autoPublish: false,
                maxUpdatesPerMinute: 5,
                categoryMappings: {},
            },
        }),
    };
    const source = loadTelegramListingsConfig(testEnv)?.chats.get(testChatId);
    assert.ok(source);
    const channelSource = { ...source, chatType: "channel" as const, allowedSenderIds: undefined };
    const telegramMessage = {
        message_id: 123,
        date: publishedAt,
        chat: { id: Number(testChatId), type: "supergroup", username: "xoven_test_listings" },
        from: { id: 8519508488, is_bot: false },
        text: "Продам тестовый велосипед\nВелосипед в хорошем состоянии. Всё работает исправно. Это тест автоматического импорта объявлений в Ozen Board.\nЦена: 100 zł",
    };

    const updates = [
        { update: { message: telegramMessage }, source },
        {
            update: {
                channel_post: {
                    ...telegramMessage,
                    chat: { ...telegramMessage.chat, type: "channel" },
                    from: undefined,
                },
            },
            source: channelSource,
        },
    ];
    for (const { update, source: updateSource } of updates) {
        const adapter = createTelegramMessageAdapter(update, updateSource);
        const page = await adapter.fetchPage(undefined, 1, new AbortController().signal);
        assert.equal(page.items.length, 1);
        const candidate = adapter.mapCandidate(page.items[0]);
        const listing = normalizeExternalListing(candidate, updateSource.source, Date.now());

        assert.equal(candidate.title, "Продам тестовый велосипед");
        assert.equal(candidate.description, "Велосипед в хорошем состоянии. Всё работает исправно. Это тест автоматического импорта объявлений в Ozen Board.");
        assert.equal(candidate.priceAmount, 100);
        assert.equal(candidate.currency, "PLN");
        assert.equal(listing.status, "review");
        assert.equal(listing.importStatus, "needs_review");
    }
});

test("Telegram messages without text and one-line commands receive safe validation reasons", () => {
    const source = configuredChat();
    assert.throws(() => mapTelegramMessageCandidate(message("", { text: undefined, caption: undefined }), source), /empty-telegram-text/);
    assert.throws(() => mapTelegramMessageCandidate(message("Продам тестовый велосипед"), source), /empty-telegram-description/);
});

test("Telegram skip diagnostics use fixed safe reason codes", () => {
    assert.equal(getTelegramListingSkipReason(new Error("unapproved-telegram-chat")), "source_not_allowed");
    assert.equal(getTelegramListingSkipReason(new Error("telegram-chat-type-mismatch")), "chat_type_mismatch");
    assert.equal(getTelegramListingSkipReason(new Error("unapproved-telegram-sender")), "sender_not_allowed");
    assert.equal(getTelegramListingSkipReason(new Error("empty-telegram-text")), "empty_text");
    assert.equal(getTelegramListingSkipReason(new Error("empty-telegram-description")), "empty_description");
    assert.equal(getTelegramListingSkipReason(new Error("arbitrary user content or secret")), "validation_failed");
});

test("Telegram allowlist requires a reviewed rights record and a public source link", () => {
    assert.throws(() => loadTelegramListingsConfig({
        ...baseEnv,
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
            [chatId]: { ...chatConfig, permissionConfirmed: false },
        }),
    }), /source-rights-not-reviewed/);
    assert.throws(() => loadTelegramListingsConfig({
        ...baseEnv,
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
            [chatId]: { ...chatConfig, publicUsername: "" },
        }),
    }), /invalid-telegram-source-config/);
    assert.throws(() => loadTelegramListingsConfig({
        ...baseEnv,
        TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED: "perhaps",
    }), /invalid-telegram-auto-publish-switch/);
    assert.throws(() => loadTelegramListingsConfig({
        ...baseEnv,
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
            [chatId]: { ...chatConfig, maxUpdatesPerMinute: 61 },
        }),
    }), /invalid-telegram-chat-config/);
    assert.throws(() => loadTelegramListingsConfig({
        ...baseEnv,
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
            [chatId]: { ...chatConfig, chatType: "private" },
        }),
    }), /invalid-telegram-chat-config/);
    assert.throws(() => loadTelegramListingsConfig({
        ...baseEnv,
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
            [chatId]: { ...chatConfig, allowedSenderIds: ["0", "not-an-id"] },
        }),
    }), /invalid-telegram-chat-config/);
    assert.equal(configuredChat().maxUpdatesPerMinute, 5);
    assert.equal(configuredChat().chatType, "supergroup");
});

test("an explicitly empty sender allowlist safely rejects every group author", () => {
    const source = loadTelegramListingsConfig({
        ...baseEnv,
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
            [chatId]: { ...chatConfig, allowedSenderIds: [] },
        }),
    })?.chats.get(chatId);
    assert.ok(source);
    assert.throws(() => mapTelegramMessageCandidate(message(
        "Sprzedam rower trekkingowy\nRower w dobrym stanie, po przeglądzie, odbiór możliwy w Warszawie.",
    ), source), /unapproved-telegram-sender/);
});

test("chat type and author filters remain optional for existing source configurations", () => {
    const legacyConfig = { ...chatConfig } as Record<string, unknown>;
    delete legacyConfig.chatType;
    delete legacyConfig.allowedSenderIds;
    const source = loadTelegramListingsConfig({
        ...baseEnv,
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({ [chatId]: legacyConfig }),
    })?.chats.get(chatId);
    assert.ok(source);
    assert.equal(source.chatType, undefined);
    assert.equal(source.allowedSenderIds, undefined);
    assert.doesNotThrow(() => mapTelegramMessageCandidate(message(
        "Sprzedam rower trekkingowy\nRower w dobrym stanie, po przeglądzie, odbiór możliwy w Warszawie.",
        { chat: { id: Number(chatId), type: "group", username: chatConfig.publicUsername } },
    ), source));
});

test("Telegram adapter maps an explicitly priced, categorized post to the shared external listing model", () => {
    const source = configuredChat();
    const candidate = mapTelegramMessageCandidate(message(
        "iPhone 14 Pro Max sprzedam\nTelefon w bardzo dobrym stanie, bateria sprawna, odbiór w Warszawie.\nKategoria: electronics\nCena: 1 200 PLN",
    ), source);
    assert.match(String(candidate.sourceListingId), new RegExp(`^${chatId}_\\w{32}$`));
    assert.equal(candidate.originalUrl, `https://t.me/${chatConfig.publicUsername}/42`);
    assert.equal(candidate.priceAmount, 1200);
    assert.equal(candidate.currency, "PLN");
    assert.equal(candidate.offerType, "paid");
    assert.equal(candidate.sourceCategory, "electronics");
    assert.equal(candidate.sourcePublishedAt, publishedAt * 1000);
    assert.equal("userId" in candidate, false);

    const normalized = normalizeExternalListing(candidate, source.source, Date.now());
    assert.equal(normalized.status, "active");
    assert.equal(normalized.sourceName, chatConfig.displayName);
    assert.equal(normalized.rightsReference, chatConfig.rightsReference);
    const repost = mapTelegramMessageCandidate(message(
        "iPhone 14 Pro Max sprzedam\nTelefon w bardzo dobrym stanie, bateria sprawna, odbiór w Warszawie.\nKategoria: electronics\nCena: 1 200 PLN",
        { message_id: 99 },
    ), source);
    assert.equal(repost.sourceListingId, candidate.sourceListingId);
});

test("Telegram sources require explicit auto-publish opt-in; otherwise eligible listings stay in review", () => {
    const env = {
        ...baseEnv,
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
            [chatId]: { ...chatConfig, autoPublish: false },
        }),
    };
    const source = loadTelegramListingsConfig(env)?.chats.get(chatId);
    assert.ok(source);
    const candidate = mapTelegramMessageCandidate(message(
        "iPhone 14 Pro Max sprzedam\nTelefon w bardzo dobrym stanie, bateria sprawna, odbiór w Warszawie.\nKategoria: electronics",
    ), source);
    const normalized = normalizeExternalListing(candidate, source.source, Date.now());
    assert.equal(normalized.status, "review");
    assert.equal(normalized.importStatus, "needs_review");
});

test("omitting autoPublish keeps eligible Telegram listings in review by default", () => {
    const defaultChatConfig = { ...chatConfig };
    delete (defaultChatConfig as { autoPublish?: boolean }).autoPublish;
    const source = loadTelegramListingsConfig({
        ...baseEnv,
        TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED: undefined,
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({ [chatId]: defaultChatConfig }),
    })?.chats.get(chatId);
    assert.ok(source);
    assert.equal(source.autoPublish, false);

    const candidate = mapTelegramMessageCandidate(message(
        "iPhone 14 Pro Max sprzedam\nTelefon w bardzo dobrym stanie, bateria sprawna, odbiór w Warszawie.\nKategoria: electronics",
    ), source);
    const normalized = normalizeExternalListing(candidate, source.source, Date.now());
    assert.equal(normalized.status, "review");

    const sourceOptedIn = loadTelegramListingsConfig({
        ...baseEnv,
        TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED: undefined,
    })?.chats.get(chatId);
    assert.ok(sourceOptedIn);
    assert.equal(sourceOptedIn.autoPublish, false);
});

test("Telegram free and exchange labels do not create a misleading zero price", () => {
    const source = configuredChat();
    const free = mapTelegramMessageCandidate(message(
        "Oddam darmową lampę\nLampa jest sprawna i można odebrać ją osobiście w centrum miasta.\nOffer: free",
    ), source);
    const exchange = mapTelegramMessageCandidate(message(
        "Wymienię rower miejski\nRower sprawny, szukam podobnego modelu z ramą w mniejszym rozmiarze.\nOffer: exchange",
    ), source);
    assert.equal(free.offerType, "free");
    assert.equal("priceAmount" in free, false);
    assert.equal(exchange.offerType, "exchange");
    assert.equal("priceAmount" in exchange, false);
});

test("Telegram adapter rejects weak, forwarded, private, mismatched and malformed-price posts", () => {
    const source = configuredChat();
    assert.throws(() => mapTelegramMessageCandidate(message("Telefon z usterką"), source), /empty-telegram-description/);
    assert.throws(() => mapTelegramMessageCandidate(message(
        "iPhone 14 Pro sprzedam\nTelefon w bardzo dobrym stanie, bateria sprawna, odbiór w Warszawie.",
        { forward_origin: { type: "channel" } },
    ), source), /forwarded-or-automated-telegram-message/);
    assert.throws(() => mapTelegramMessageCandidate(message(
        "iPhone 14 Pro sprzedam\nTelefon w bardzo dobrym stanie, bateria sprawna, odbiór w Warszawie.",
        { chat: { id: Number(chatId), type: "private", username: chatConfig.publicUsername } },
    ), source), /unapproved-telegram-chat/);
    assert.throws(() => mapTelegramMessageCandidate(message(
        "iPhone 14 Pro sprzedam\nTelefon w bardzo dobrym stanie, bateria sprawna, odbiór w Warszawie.",
        { chat: { id: Number(chatId), type: "supergroup", username: "different_public_name" } },
    ), source), /telegram-public-link-unavailable/);
    assert.throws(() => mapTelegramMessageCandidate(message(
        "iPhone 14 Pro sprzedam\nTelefon w bardzo dobrym stanie, bateria sprawna, odbiór w Warszawie.",
        { chat: { id: Number(chatId), type: "group", username: chatConfig.publicUsername } },
    ), source), /telegram-chat-type-mismatch/);
    assert.throws(() => mapTelegramMessageCandidate(message(
        "iPhone 14 Pro sprzedam\nTelefon w bardzo dobrym stanie, bateria sprawna, odbiór w Warszawie.",
        { from: { id: 987654321, is_bot: false } },
    ), source), /unapproved-telegram-sender/);
    assert.throws(() => mapTelegramMessageCandidate(message(
        "iPhone 14 Pro sprzedam\nTelefon w bardzo dobrym stanie, bateria sprawna, odbiór w Warszawie.",
        { from: undefined },
    ), source), /unapproved-telegram-sender/);
    assert.throws(() => mapTelegramMessageCandidate(message(
        "iPhone 14 Pro sprzedam\nTelefon w bardzo dobrym stanie, bateria sprawna, odbiór w Warszawie.\nCena: -20 PLN",
    ), source), /invalid-telegram-listing-price/);
});

test("Telegram does not retain price when the reviewed rights scope excludes it", () => {
    const env = {
        ...baseEnv,
        TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
            [chatId]: { ...chatConfig, rightsFields: ["title", "originalUrl", "description"] },
        }),
    };
    const source = loadTelegramListingsConfig(env)?.chats.get(chatId);
    assert.ok(source);
    const candidate = mapTelegramMessageCandidate(message(
        "iPhone 14 Pro Max sprzedam\nTelefon w bardzo dobrym stanie, bateria sprawna, odbiór w Warszawie.\nCena: 1200 PLN",
    ), source);
    assert.equal("priceAmount" in candidate, false);
});

test("public Telegram forum posts preserve the message thread in the original link", () => {
    const source = configuredChat();
    const candidate = mapTelegramMessageCandidate(message(
        "Sprzedam rower trekkingowy\nRower w dobrym stanie, po przeglądzie, odbiór możliwy w Warszawie.",
        { message_thread_id: 77, message_id: 43 },
    ), source);
    assert.equal(candidate.originalUrl, `https://t.me/${chatConfig.publicUsername}/77/43`);
    assert.throws(() => mapTelegramMessageCandidate(message(
        "Sprzedam rower trekkingowy\nRower w dobrym stanie, po przeglądzie, odbiór możliwy w Warszawie.",
        { message_thread_id: "77" },
    ), source), /invalid-telegram-message-thread-id/);
});

test("Telegram candidates remove embedded URLs and reject automatic forwards and bot-assisted posts", () => {
    const source = configuredChat();
    const candidate = mapTelegramMessageCandidate(message(
        "Sprzedam rower trekkingowy\nRower w dobrym stanie, po przeglądzie, odbiór możliwy w Warszawie. https://unsafe.example/promo",
    ), source);
    assert.equal(candidate.description?.includes("https://"), false);
    for (const updateFields of [{ is_automatic_forward: true }, { via_bot: { id: 123, is_bot: true } }, { from: { is_bot: true } }]) {
        assert.throws(() => mapTelegramMessageCandidate(message(
            "Sprzedam rower trekkingowy\nRower w dobrym stanie, po przeglądzie, odbiór możliwy w Warszawie.",
            updateFields,
        ), source), /forwarded-or-automated-telegram-message/);
    }
});

test("one Telegram update becomes exactly one non-snapshot importer page", async () => {
    const source = configuredChat();
    const update = { update_id: 918, message: message(
        "iPhone 14 Pro Max sprzedam\nTelefon w bardzo dobrym stanie, bateria sprawna, odbiór w Warszawie.",
    ) };
    const adapter = createTelegramMessageAdapter(update, source);
    assert.equal(adapter.providesCompleteSnapshot, false);
    assert.equal(adapter.source.id, source.source.id);
    const page = await adapter.fetchPage(undefined, 1, new AbortController().signal);
    assert.equal(page.hasMore, false);
    assert.equal(page.items.length, 1);
    assert.match(String(adapter.mapCandidate(page.items[0]).sourceListingId), new RegExp(`^${chatId}_\\w{32}$`));
    assert.equal(getTelegramUpdateId(update), 918);
    assert.equal(getTelegramUpdateChatId(update), chatId);
    assert.equal(getTelegramUpdateId({ update_id: Number.MAX_SAFE_INTEGER + 1 }), undefined);
});

test("Telegram webhook shared secret is required and compared exactly", () => {
    assert.equal(isAuthorizedTelegramWebhookSecret("secret-123", "secret-123"), true);
    assert.equal(isAuthorizedTelegramWebhookSecret("secret-123", "secret-124"), false);
    assert.equal(isAuthorizedTelegramWebhookSecret("secret-123", undefined), false);
    assert.equal(isAuthorizedTelegramWebhookSecret("", "secret-123"), false);
});

test("Telegram update ledger contract makes retries idempotent and concurrent deliveries retryable", async () => {
    class MemoryLedger implements TelegramUpdateLedger {
        private readonly updates = new Map<number, { status: TelegramUpdateClaimStatus; token?: string; leaseUntil?: number }>();

        async claim(updateId: number, now: number, claimToken: string): Promise<TelegramUpdateClaimStatus> {
            const existing = this.updates.get(updateId);
            if (existing?.status === "processed") return "processed";
            if (existing?.status === "claimed" && (existing.leaseUntil ?? 0) > now) return "busy";
            this.updates.set(updateId, { status: "claimed", token: claimToken, leaseUntil: now + 90_000 });
            return "claimed";
        }

        async finish(updateId: number, claimToken: string): Promise<boolean> {
            const existing = this.updates.get(updateId);
            if (existing?.status !== "claimed" || existing.token !== claimToken) return false;
            this.updates.set(updateId, { status: "processed" });
            return true;
        }

        async release(updateId: number, claimToken: string): Promise<void> {
            const existing = this.updates.get(updateId);
            if (existing?.status === "claimed" && existing.token === claimToken) this.updates.delete(updateId);
        }
    }

    const ledger = new MemoryLedger();
    assert.equal(await ledger.claim(918, 10_000, "first"), "claimed");
    assert.equal(await ledger.claim(918, 10_001, "concurrent"), "busy");
    assert.equal(await ledger.finish(918, "first", 10_002), true);
    assert.equal(await ledger.claim(918, 10_003, "retry"), "processed");
    assert.equal(await ledger.claim(919, 10_003, "failed"), "claimed");
    await ledger.release(919, "failed");
    assert.equal(await ledger.claim(919, 10_004, "retry-after-failure"), "claimed");
});
