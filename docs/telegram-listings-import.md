# Telegram listing import

This integration uses Telegram Bot API updates and the shared Ozen Board external-listing importer. `TELEGRAM_LISTINGS_IMPORT_ENABLED` now controls intake independently; when unset it falls back to the prior `EXTERNAL_LISTINGS_ENABLED && TELEGRAM_LISTINGS_ENABLED` gate. General external catalog visibility remains controlled by the existing switches. The ignored local file `functions/.env.ozen-board` contains only the user-provided test source and author, keeps catalog visibility and auto-publish off, and has a blank webhook URL. Its `permissionConfirmed` value relies only on the user's statement that the test posts are their own synthetic messages, and its `rightsReference` points to the source itself rather than a legal terms document. Do not treat a public message as permission to republish it.

## Current architecture

`functions/src/index.ts` exports these Telegram functions:

| Function | Kind | Purpose |
| --- | --- | --- |
| `telegramListingsWebhook` | HTTPS request, Functions v2 | Public Telegram endpoint; authenticates with the Telegram secret header |
| `registerTelegramListingsWebhook` | Callable, Functions v2 | Registers the webhook with Telegram after administrator and configuration checks |
| `deleteTelegramListingsWebhook` | Callable, Functions v2 | Removes the webhook without dropping queued updates or deleting Firebase secrets |
| `getTelegramListingsWebhookStatus` | Callable, Functions v2 | Returns a sanitized subset of `getWebhookInfo` |
| `deactivateTelegramListing` | Callable, Functions v2 | Hides one Telegram external record after administrator authorization |
| `getExternalListingsConfig` | Callable, Functions v2 | Supplies non-secret catalog visibility switches to the client |

No explicit function region is set in these declarations or in the current global options; Firebase therefore uses its default region, `us-central1`. The `functions` codebase in `firebase.json` is `default`, with Node.js 20. Local source and configuration do not establish which functions have already been deployed; this guide does not query a Firebase project to infer that state.

The webhook accepts Telegram `Update.message` and `Update.channel_post`. It verifies the configured secret header, chat ID/type/public username and per-source rights configuration, then uses the shared normalizer and Firestore repository. Update IDs are claimed transactionally; deterministic listing IDs and source URL hashes also prevent repeated imports. It ignores edits and other update kinds. Unsupported, invalid, forwarded, bot-authored and insufficient-content messages are skipped by the adapter; there is no general-purpose spam or relevance classifier.

The external listing statuses in the current shared model are `review`, `active`, `stale`, and `hidden`; it has no persisted `rejected` status. Invalid candidates are skipped and the update ledger is completed. `importStatus` is `ready` or `needs_review`. Telegram records are kept in `review` by default. They become `active` only when a category is mapped, the candidate does not require review, and both the global and per-chat publication switches explicitly allow it.

## Rights and allowlist

Only add a source after confirming that permission covers the message author and every copied field. A group administrator's permission may not grant rights to member-authored content or images. The adapter does not download Telegram media or images. The config validator requires an HTTPS `rightsReference`, review date, `permissionConfirmed: true`, and the permitted field set to include `title` and `originalUrl`. This is an operator attestation, not an automated legal check.

`rightsReference` and `rightsReviewedAt` are stored on imported external documents. Active `externalAds` documents are publicly readable under the current Firestore rules, so `rightsReference` must be a public-safe link or reference and must not contain private agreements, credentials, or internal notes. Keep private evidence in the project's approved private records and put only a safe reference in the feed configuration.

The allowlist is keyed by Telegram's numeric chat ID. `publicUsername` must match the incoming `chat.username`; private chats and mismatches are ignored. Optional `chatType` pins a source to one of `group`, `supergroup`, or `channel`. Optional `allowedSenderIds` pins accepted messages to Telegram user IDs; when present, only those IDs may post, and an empty array denies all senders. These fields are backward-compatible for existing feed configurations. Public links are created as `https://t.me/<username>/<message_id>`; forum-topic links include the thread ID: `https://t.me/<username>/<thread_id>/<message_id>`. If a username or thread ID cannot be verified, the message is not imported.

Example shape only; it contains no real source or permission:

```json
{
  "-1000000000000": {
    "displayName": "Approved source name",
    "publicUsername": "public_channel_or_group",
    "chatType": "supergroup",
    "allowedSenderIds": ["123456789"],
    "rightsReference": "https://example.org/public-syndication-terms",
    "rightsReviewedAt": 1800000000000,
    "permissionConfirmed": true,
    "rightsFields": ["title", "originalUrl", "description", "category", "price", "publishedAt"],
    "autoPublish": false,
    "maxUpdatesPerMinute": 30,
    "categoryMappings": {
      "electronics": { "category": "sell", "catalogCategory": "electronics", "catalogSubcategory": "phonesComputers" }
    }
  }
}
```

`maxUpdatesPerMinute` is optional (default 30) and must be 1–60. Category mapping keys are lowercased source labels. A mapped category must match the app's actual category identifiers. Only explicitly labeled prices with PLN are parsed; missing or malformed prices do not get invented. For publication, an explicit supported offer type and a mapped category are required. Images and location are not inferred from Telegram text.

## Secrets and environment

The repository `.gitignore` excludes `.env` and `.env.*`; verify the project Functions file is ignored with `git check-ignore -v functions/.env.ozen-board`. The current checkout also has a pre-existing tracked root `.env`; do not put Telegram values there. Its contents were not inspected or changed as part of this work. Audit that file separately and remove it from version control only after preserving any required local configuration and checking whether it contains other credentials. Never print or paste environment files; keep the project-specific `functions/.env.ozen-board` separate from unrelated local configuration.

The project owner reports that both Firebase Functions secrets already exist in `ozen-board`; this work did not read, replace, or print them. If a secret is later confirmed missing, the CLI prompts for its value; do not put a secret on the command line:

```powershell
firebase functions:secrets:set TELEGRAM_BOT_TOKEN --project ozen-board
firebase functions:secrets:set TELEGRAM_WEBHOOK_SECRET --project ozen-board
```

`TELEGRAM_BOT_TOKEN` is only read by server Functions. `TELEGRAM_WEBHOOK_SECRET` is separate and must be 1–256 ASCII letters, digits, `_` or `-`. Telegram sends it in `X-Telegram-Bot-Api-Secret-Token`; the webhook compares it in constant time. Never place either secret in React/Vite configuration, `VITE_*`, source, fixtures, logs, callable responses, Git, or a browser console.

The non-secret values belong in `functions/.env.<FIREBASE_PROJECT_ID>` (or the project's approved Functions environment configuration). The prepared `functions/.env.ozen-board` has Telegram intake enabled, the shared external catalog disabled, Telegram catalog visibility disabled, auto-publish disabled, the supplied sender ID allowlisted, and the webhook URL blank. It will not receive messages until deployed and registered; it does not enable catalog display. Fill in the webhook URL from the deployed function before registration.

```dotenv
EXTERNAL_LISTINGS_ENABLED=true
TELEGRAM_LISTINGS_ENABLED=true
TELEGRAM_LISTINGS_IMPORT_ENABLED=true
TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED=false
TELEGRAM_LISTINGS_WEBHOOK_URL=https://<deployed-functions-host>/telegramListingsWebhook
TELEGRAM_LISTINGS_CHATS_JSON={...approved-chat-config...}
```

The exact webhook URL is the deployed `telegramListingsWebhook` HTTPS endpoint. `TELEGRAM_LISTINGS_IMPORT_ENABLED=true` enables only Telegram intake and does not enable the general external catalog or partner importer. If this new variable is unset, importer behavior falls back to the old conjunction of `EXTERNAL_LISTINGS_ENABLED=true` and `TELEGRAM_LISTINGS_ENABLED=true`. `EXTERNAL_LISTINGS_ENABLED=true` still enables the whole external catalog, so existing active records from other sources may become visible; the partner adapter also reads it, but `runPartnerJsonFeedImport` currently has no export or schedule in `functions/src/index.ts`. Catalog visibility remains on the legacy switches: Telegram cards show only when both external catalog and `TELEGRAM_LISTINGS_ENABLED` are true. Invalid values for the new import flag fail closed.

The Telegram source is opt-in at two levels: global `TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED=true` and that source's `autoPublish: true`; either false keeps qualified records in `review`. Invalid flag values fail closed. Do not place private rights documents in the environment JSON.

The webhook has `maxInstances: 5`, `concurrency: 5`, and Telegram registration sets `max_connections: 5`. The adapter also applies a per-chat Firestore rate limit of 1–60 updates per minute. A separate Telegram-only Firestore transaction limits new Telegram records to 20 per UTC day. At that limit an incoming update is acknowledged and dropped; it is not queued for the next day. Existing record updates and duplicates do not consume the new-record quota. Firestore outage or rate limiting returns a retryable response; the update ledger allows a later delivery to try again.

## Administrator access and webhook operations

This repository has no Firebase custom-claim or role-provisioning mechanism for these operations. The new callables follow the existing server-side email allowlist used by the project's lead callables, and additionally require Firebase Auth's signed `email_verified === true` claim. An unverified or non-allowlisted account is denied. The two configured addresses must remain controlled by their owners; do not extend the list without the project's normal administrator-access review. After account verification, refresh the Firebase Auth session so the signed token contains the current verification claim.

There is no in-app administration screen. An authenticated internal Ozen Board client can invoke the callable through the Firebase SDK while the verified administrator is signed in. Example client-side call (contains no secret):

```ts
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./app/firebase";

const functions = getFunctions(app, "us-central1");
const check = httpsCallable(functions, "getTelegramListingsWebhookStatus");
const { data } = await check();
```

The callable checks the Firebase Auth context on the server. Do not copy an ID token into logs or tickets. The status result contains only whether a webhook exists/matches, pending update count, max connections, allowed update names and last error timestamp. It does not return the webhook URL or Telegram's raw error text.

Before registration, the server checks that Telegram import is enabled by the new switch or the legacy fallback, the source config is valid, the URL is HTTPS on a Firebase Functions/Cloud Run host, and the webhook secret is valid. It first calls `getWebhookInfo`; if a different webhook is already installed it refuses to overwrite it. It sets only `message` and `channel_post`, preserves pending updates (`drop_pending_updates: false`), and confirms the result. `deleteTelegramListingsWebhook` also preserves pending updates and leaves Firebase secrets intact.

## Limited deployment command for `ozen-board` (not executed)

The Functions codebase is `default`, and the following are the exact Firebase exports required for the Telegram path and the client visibility switches:

```powershell
firebase deploy --only functions:telegramListingsWebhook,functions:registerTelegramListingsWebhook,functions:deleteTelegramListingsWebhook,functions:getTelegramListingsWebhookStatus,functions:deactivateTelegramListing,functions:getExternalListingsConfig --project ozen-board
```

The Firebase CLI `--only functions:<name>` selector supports comma-separated exports. This targets the supplied project and deploys only the six functions; it does not deploy Firestore Rules or indexes. With the current blank webhook URL, registration will fail safely until the URL is filled after deployment. This guide does not run any deployment.

## Safe first test in the supplied project

1. The supplied numeric Telegram user ID is in `allowedSenderIds`; the configured type is `supergroup`. The local `rightsReference` points to the group as a source reference, not to a separate legal terms document.
2. Keep `EXTERNAL_LISTINGS_ENABLED=false` and `TELEGRAM_LISTINGS_ENABLED=false` to import Telegram records without showing any external catalog cards. The independent `TELEGRAM_LISTINGS_IMPORT_ENABLED=true` switch enables only intake. If the general catalog is later enabled, existing active records from other sources may become visible.
3. Keep global and per-chat `autoPublish` false. Deploy only the six listed functions. The webhook URL can be read from `firebase functions:list --project ozen-board` after deployment; update the local project env file and redeploy the environment-dependent exports before registration:

   ```powershell
   firebase deploy --only functions:telegramListingsWebhook,functions:registerTelegramListingsWebhook,functions:getTelegramListingsWebhookStatus,functions:getExternalListingsConfig --project ozen-board
   ```
4. While signed in as a verified account in the existing server-side admin allowlist, call `getTelegramListingsWebhookStatus`, then `registerTelegramListingsWebhook`. If a different webhook is already configured, inspect it through the existing bot owner and explicitly decide how to handle it; registration will not replace it automatically.
5. Send one synthetic, sufficiently informative test post from the approved test chat. Check the sanitized callable status and confirm Telegram deliveries are reaching the endpoint. The webhook logs only generic counters, not the message text, chat ID, token, or secret.
6. In the Firebase console or trusted server-side tooling, inspect the `externalAds` document: it should have `isExternal: true`, a hashed Telegram `sourceId`, source name, `originalUrl`, publication/import timestamps, and `status: "review"`. Check the corresponding `telegramWebhookUpdates` entry. Confirm a client catalog request cannot read the review record. For a delivery retry, Telegram may redeliver the same update after a non-2xx response; use an access-controlled replay harness if you need to force the same `update_id` without waiting. Do not paste the secret or update body into a browser console or ticket. The expected result is one listing document and a duplicate acknowledgment; the automated ledger test already verifies this behavior against the local emulator.
7. To test deactivation, invoke `deactivateTelegramListing` for this synthetic document with `reason: "original_removed"` or `"original_invalid"`. Confirm it becomes `hidden` and a non-Telegram source cannot be changed through this callable. This action does not erase stored text.
8. Call `deleteTelegramListingsWebhook`, verify `getTelegramListingsWebhookStatus` reports no registered webhook, then set `TELEGRAM_LISTINGS_IMPORT_ENABLED=false`, `TELEGRAM_LISTINGS_ENABLED=false`, and `EXTERNAL_LISTINGS_ENABLED=false`. Redeploy the webhook, register, and catalog-config functions that read those values. Keep secrets only as long as the project's secret-retention policy requires; webhook removal does not delete them.

Tests in this repository mock Telegram Bot API responses. Firestore integration tests use only a local emulator and synthetic documents. Neither test suite proves a live Bot API connection. Do not register a production webhook or create a Firebase secret as part of code verification.

## Visibility, review, deactivation and source lifecycle

Firestore Rules allow public clients to read `externalAds` documents only while `status == "active"`; `review`, `stale`, and `hidden` are not publicly readable. Telegram records are stored server-side and client writes are denied. `getExternalListingsConfig` provides a separate `telegramEnabled` switch to the app catalog; turning Telegram off hides Telegram cards in the Ozen Board UI while other external sources continue to display. The switch is a catalog presentation control, not an authorization boundary: as long as an external document remains `active`, the existing public Firestore rule still permits direct reads. Use `deactivateTelegramListing` to make a particular record `hidden` and deny public reads.

Telegram Bot API does not guarantee that the bot receives an update when somebody deletes or edits another user's message. There is no automatic original-deletion synchronization. An authorized moderator must check the source and use the manual deactivation callable. The hidden document and its text remain for audit/retention; this is not a deletion or legal-retention workflow. Deactivation only accepts Telegram-generated source IDs and never changes partner or user ads. The shared importer preserves hidden records as hidden on later sightings.

## Billing and operational risks

Deploying Functions v2 requires the project's billing configuration to support Cloud Functions. Possible charges include function invocations, CPU/memory time, networking, image/container builds and Artifact Registry storage. Firestore reads, writes, deletes, storage and TTL-driven deletions may also incur costs. Quotas and pricing change; check the current Firebase and Google Cloud billing pages for `ozen-board` before enabling an active source. Rate limits and the 20-new-record daily cap constrain volume but do not guarantee a zero bill.

Relevant official references: [Telegram Bot API](https://core.telegram.org/bots/api), [Telegram message links](https://core.telegram.org/api/links), [Firebase Functions v2 HTTPS options](https://firebase.google.com/docs/reference/functions/2nd-gen/node/firebase-functions.https.httpsoptions), [deploy specific Cloud Functions](https://firebase.google.com/docs/functions/manage-functions), [Functions environment configuration](https://firebase.google.com/docs/functions/config-env), [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Firebase pricing](https://firebase.google.com/pricing), and [Firestore pricing](https://cloud.google.com/firestore/pricing).

## Current status

No live Firebase or Telegram network call has been made by this implementation work. The ignored local `functions/.env.ozen-board` names only the user-provided test group and sender, enables the new Telegram intake flag, keeps external catalog visibility and auto-publish off, and leaves the webhook URL blank. The project owner reports that the two required secrets exist remotely; they were not accessed or changed. No webhook is registered by this work and no live Telegram message has been received. The deployed endpoint URL is still required before registration. There is no Telegram moderation UI, and the adapter's quality checks do not replace human review.
