# Telegram listing import

Telegram intake is independent from the shared partner-feed importer. Accepted Telegram posts become normal Ozen Board ads in `ads`; uncertain posts are kept in a private server-only `telegramImportRecords` review queue. Existing partner imports continue to use `externalAds`. `TELEGRAM_LISTINGS_IMPORT_ENABLED` controls intake independently; when unset it falls back to the prior `EXTERNAL_LISTINGS_ENABLED && TELEGRAM_LISTINGS_ENABLED` gate. General external catalog visibility remains controlled by the existing switches. The ignored local file `functions/.env.ozen-board` is a per-machine deployment input and does not prove the values currently running in Firebase. Before any deployment, verify the global and per-source auto-publish switches explicitly; when both are `true`, eligible posts publish immediately. The test source's `permissionConfirmed` value relies only on the user's statement that the test posts are their own synthetic messages, and its `rightsReference` points to the source itself rather than a legal terms document. Do not treat a public message as permission to republish it.

## Current architecture

`functions/src/index.ts` exports these Telegram functions:

| Function | Kind | Purpose |
| --- | --- | --- |
| `telegramListingsWebhook` | HTTPS request, Functions v2 | Public Telegram endpoint; authenticates with the Telegram secret header |
| `registerTelegramListingsWebhook` | Callable, Functions v2 | Registers the webhook with Telegram after administrator and configuration checks |
| `deleteTelegramListingsWebhook` | Callable, Functions v2 | Removes the webhook without dropping queued updates or deleting Firebase secrets |
| `getTelegramListingsWebhookStatus` | Callable, Functions v2 | Returns a sanitized subset of `getWebhookInfo` |
| `deactivateTelegramListing` | Callable, Functions v2 | Deactivates a Telegram `ads` record or legacy Telegram `externalAds` record after administrator authorization |
| `listTelegramListingsForModeration` | Callable, Functions v2 | Returns private Telegram review items only to verified administrators |
| `moderateTelegramListing` | Callable, Functions v2 | Validates and approves/rejects one Telegram import server-side |
| `getExternalListingsConfig` | Callable, Functions v2 | Supplies non-secret catalog visibility switches to the client |

No explicit function region is set in these declarations or in the current global options; Firebase therefore uses its default region, `us-central1`. The `functions` codebase in `firebase.json` is `default`, with Node.js 20. Local source and configuration do not establish which functions have already been deployed; this guide does not query a Firebase project to infer that state.

The webhook accepts `message`, `channel_post`, `edited_message`, and `edited_channel_post`. It verifies the secret header, chat ID/type/public username, sender allowlist where applicable, and the source rights configuration. The Telegram-specific path maps approved data to the normal `ads` schema using the server-side `createAd` validators. Update delivery IDs and a stable hash of source ID + chat ID + message ID provide separate idempotency layers. Channel posts without a verifiable author are retained for human review. Edits to already published ads are staged as a pending revision and never overwrite the public ad automatically.

Telegram import record states are `pending_review`, `published`, `rejected`, and `deactivated`. A draft is not inserted into the public `ads` catalog until it is automatically published under the strict checks or an administrator approves it. Rejection is sticky for that Telegram message identity. Admin review lives at `/admin/telegram-moderation`, separate from the TOP promotion queue. Auto-publishing remains off unless both global and per-source switches are explicitly enabled; even then, the source permission, title, description, category mapping, offer type, location and any copied contact or image must pass validation. Published edits are staged for review.

The server-side Telegram evaluator makes one of three decisions: `auto_publish` only when the source and both opt-in switches permit it and the message has no validation/review reasons; `needs_review` when the post may be an ad but any required field, classification, author, media, or policy condition is uncertain; and `reject` for parser failures, high-confidence spam, text-empty messages without media, and command-only messages such as `/start`. Photo-only posts stay in review because a photo could be part of a listing. Python-side classification is advisory only and cannot set or override this server decision.

## Rights and allowlist

Only add a source after confirming that permission covers the message author and every copied field. A group administrator's permission may not grant rights to member-authored content or images. The importer downloads Telegram photos server-side only when `images` is in the source's permitted `rightsFields`; it validates the file signature and enforces an 8 MiB per-image cap before copying to Firebase Storage. One Telegram photo (largest available size) is copied per message. Telegram media-group messages have separate message IDs and are held for review rather than auto-published separately; album aggregation is not implemented. The config validator requires an HTTPS `rightsReference`, review date, `permissionConfirmed: true`, and the permitted field set to include `title` and `originalUrl`. `contact` is an optional permitted field. This is an operator attestation, not an automated legal check.

Uploaded image objects use the server Admin SDK under `telegram-imports/` and receive Firebase download-token URLs for display in ordinary ad cards/details. This repository does not configure a `storage` rules file in `firebase.json`; the deployed project's current Storage rules were not queried or changed. Before deployment, inspect them and verify the intended public image access and cleanup/retention policy.

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
            "rightsFields": ["title", "originalUrl", "description", "category", "price", "location", "images", "contact", "publishedAt"],
    "autoPublish": false,
    "maxUpdatesPerMinute": 30,
    "categoryMappings": {
      "electronics": { "category": "sell", "catalogCategory": "electronics", "catalogSubcategory": "phonesComputers" }
    }
  }
}
```

`maxUpdatesPerMinute` is optional (default 30) and must be 1–60. Category mapping keys are lowercased source labels. A mapped category must match the app's actual category identifiers. Telegram price parsing accepts explicit PLN values. A numeric price alone does not imply `paid`: an explicit supported offer type is required. An explicitly `paid` offer may omit the amount and will display the existing “price from owner” label; ordinary site users still must provide a price. Free and exchange normalization is unchanged. Location and contacts are copied only from explicit metadata lines, never inferred from the Telegram author.

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

Before registration, the server checks that Telegram import is enabled by the new switch or the legacy fallback, the source config is valid, the URL is HTTPS on a Firebase Functions/Cloud Run host, and the webhook secret is valid. It first calls `getWebhookInfo`; if a different webhook is already installed it refuses to overwrite it. It sets `message`, `channel_post`, `edited_message`, and `edited_channel_post`, preserves pending updates (`drop_pending_updates: false`), and confirms the result. `deleteTelegramListingsWebhook` also preserves pending updates and leaves Firebase secrets intact.

## Limited deployment command for `ozen-board` (not executed)

The Functions codebase is `default`, and the following are the exact Firebase exports required for the Telegram path and the client visibility switches:

```powershell
firebase deploy --only functions:telegramListingsWebhook,functions:registerTelegramListingsWebhook,functions:deleteTelegramListingsWebhook,functions:getTelegramListingsWebhookStatus,functions:deactivateTelegramListing,functions:listTelegramListingsForModeration,functions:moderateTelegramListing,functions:getExternalListingsConfig --project ozen-board
```

The Firebase CLI `--only functions:<name>` selector supports comma-separated exports. This targets the supplied project and deploys only the eight named functions; it does not deploy Firestore Rules or indexes. With the current blank webhook URL, registration will fail safely until the URL is filled after deployment. This guide does not run any deployment.

## Safe first test in the supplied project

1. The supplied numeric Telegram user ID is in `allowedSenderIds`; the configured type is `supergroup`. The local `rightsReference` points to the group as a source reference, not to a separate legal terms document.
2. Keep `EXTERNAL_LISTINGS_ENABLED=false` and `TELEGRAM_LISTINGS_ENABLED=false` to import Telegram records without showing any external catalog cards. The independent `TELEGRAM_LISTINGS_IMPORT_ENABLED=true` switch enables only intake. If the general catalog is later enabled, existing active records from other sources may become visible.
3. Keep global and per-chat `autoPublish` false. Deploy only the eight listed functions. The webhook URL can be read from `firebase functions:list --project ozen-board` after deployment; update the local project env file and redeploy the environment-dependent exports before registration:

   ```powershell
   firebase deploy --only functions:telegramListingsWebhook,functions:registerTelegramListingsWebhook,functions:getTelegramListingsWebhookStatus,functions:getExternalListingsConfig --project ozen-board
   ```
4. While signed in as a verified account in the existing server-side admin allowlist, call `getTelegramListingsWebhookStatus`, then `registerTelegramListingsWebhook`. If a different webhook is already configured, inspect it through the existing bot owner and explicitly decide how to handle it; registration will not replace it automatically.
5. Send one synthetic, sufficiently informative test post from the approved test chat. Check the sanitized callable status and confirm Telegram deliveries are reaching the endpoint. The webhook logs only generic counters, not the message text, chat ID, token, or secret.
6. With auto-publish disabled, inspect the private `telegramImportRecords` entry using trusted server-side tooling and the admin queue at `/admin/telegram-moderation`. It should be `pending_review`; client Firestore reads of that record must fail. After an administrator explicitly approves it, verify one active normal document in `ads`, its Telegram badge/source URL, photos (when permitted), and the matching `telegramImportRecords` state `published`. Check the matching `telegramWebhookUpdates` entry. Do not paste the secret or update body into a browser console or ticket. The local emulator tests verify one normal ad per message identity, retry deduplication, edit staging, and sticky rejection.
7. To test deactivation, invoke `deactivateTelegramListing` for a regular Telegram ad with `telegramImportId` set to the private record key and `reason: "original_removed"` or `"original_invalid"`. Confirm the ad becomes hidden and a non-Telegram ad cannot be changed through this callable. Legacy Telegram `externalAds` still use `externalAdId`. This action does not erase stored text.
8. Call `deleteTelegramListingsWebhook`, verify `getTelegramListingsWebhookStatus` reports no registered webhook, then set `TELEGRAM_LISTINGS_IMPORT_ENABLED=false`, `TELEGRAM_LISTINGS_ENABLED=false`, and `EXTERNAL_LISTINGS_ENABLED=false`. Redeploy the webhook, register, and catalog-config functions that read those values. Keep secrets only as long as the project's secret-retention policy requires; webhook removal does not delete them.

Tests in this repository mock Telegram Bot API responses. Firestore integration tests use only a local emulator and synthetic documents. Neither test suite proves a live Bot API connection. Do not register a production webhook or create a Firebase secret as part of code verification.

## Visibility, review, deactivation and source lifecycle

Firestore Rules allow public clients to read `ads` only when `status == "active"`; review candidates are held in `telegramImportRecords`, which denies all client access. Published Telegram ads are ordinary `ads` documents with optional source attribution. Legacy Telegram `externalAds` documents remain separate and keep their previous access behavior. `getExternalListingsConfig` still controls the shared external catalog UI; it does not control visibility of Telegram ads created in `ads`. Use the admin moderation callable or `deactivateTelegramListing` to keep an imported ad from public reads.

Telegram Bot API does not guarantee that the bot receives an update when somebody deletes or edits another user's message. There is no automatic original-deletion synchronization. An authorized moderator must check the source and use the manual deactivation callable. The hidden document and its text remain for audit/retention; this is not a deletion or legal-retention workflow. Deactivation only accepts Telegram-generated source IDs and never changes partner or user ads. The shared importer preserves hidden records as hidden on later sightings.

## Telethon collector boundary

`C:\Users\V13\IdeaProjects\ozen-telegram-collector` remains an owner-run local Telethon process. `telegramCollectorIngest` is a separate HTTPS ingress protected by a timestamped HMAC over the exact request bytes. The client wire format contains only chat/message metadata, text and at most one bounded image. It cannot set a source identity, source rights, trust status, owner, publication status, or publication decision. The server reconstructs a Telegram-shaped update, then uses the same allowlist, author checks, parser, rate limiter, update ledger, deduplication, Storage validation and `ingestTelegramAd()` path as the Bot API webhook. Collector ingress also fails closed unless that source has an explicit non-empty `allowedSenderIds` list. The local collector now separately requires an explicit sender-ID allowlist for every configured chat and rejects unknown authors before classifying, journaling, or sending their content. A channel post without a verifiable allowlisted sender is not collected; Bot API channel posts without a verifiable sender remain in review by the existing parser.

The local outbox is SQLite under the current Windows user's Local AppData by default. It persists new deliveries, edits, bounded retries and permanent failures; historical `candidates.jsonl` records are not replayed. A per-machine process lock prevents competing Telethon clients from opening the same session. Events older than the local process start are ignored, and no history iterator is used. Image transfer is separately opt-in with `image_chat_ids`; without it, messages that contain a photo are routed to review rather than silently auto-published without that photo. Local logs contain fixed outcome labels and counts only, never message text, sender IDs, chat IDs, API hashes, HMAC values or session data.

The Bot API keeps Telegram's numeric `update_id` in the durable delivery ledger; the collector hashes the signed canonical request body so exact outbox retries use the same collector ledger entry. Both then converge on the same source/chat/message record and the existing Firestore import transaction. A second non-edit delivery of that message is also compared through a server-computed fingerprint of all retained text fields (excluding transport-specific photo IDs), so a Bot API/Telethon duplicate is stopped before another photo upload when it arrives after the first record; a concurrent loser is cleaned up without replacing the existing candidate. New listing records also store a content-only fingerprint. A small `dedup_marker` document in the existing private `telegramImportRecords` collection serializes simultaneous imports of the same listing fingerprint; it is excluded from the moderation query and cannot be read by clients. An identical title/description/category/offer/location already pending or published on another message is held for review rather than auto-published. Published Telegram edits still use native transport update IDs and are staged for review. Older records are checked by a bounded legacy lookup and are not backfilled. The matching is conservative and may produce false-positive reviews.

The source allowlist remains the authority. Do not add a group just because it is public, visible in Telethon, or joined by the account. Confirm that the source owner may authorize reuse of the relevant authors' content and retained fields. For collector auto-publication, the server additionally requires a non-empty author ID allowlist, source rights to all fields, source-level `autoPublish: true`, the global Telegram auto-publish switch, and a parser result with no review reasons. Unknown offer type/category, missing required fields, unverified channel author, external links, unsupported/missing photo, and other uncertainty remain in `telegramImportRecords` for the existing admin moderator. High-confidence blocked account/SIM-card spam patterns are rejected server-side; broader financial/crypto risk terms remain review signals to avoid false-positive deletion.

## Telethon setup and first test

No non-test source, server secret, session, webhook or deployment was activated by this change. The ignored local collector `config.json` is prepared for exactly the already specified test group and author; images remain disabled there. The available runtime environment did not contain `TELEGRAM_API_ID` or `TELEGRAM_API_HASH`; the session file was not read or copied. A SQLite metadata-only check found stored auth-key material, but that cannot prove the Telegram session is still valid without the API credentials. The prior local candidate journal exposed these historical public-source candidates (counts are old local observations, not current membership or permission): `Avtopolska777` (1), `gdanskp` (62), `reklamuvka888` (24), `ukrainians_in_torun` (3), and `warsawwork` (47). None is allowlisted or rights-confirmed by this report. The test group is limited locally to the owner's own sender ID and may be used only for synthetic posts the owner authored; this does not authorize third-party group content.

1. In Firebase Console → Secret Manager for project `ozen-board`, check whether `TELEGRAM_COLLECTOR_HMAC_SECRET` already exists. Do not open or copy an existing value. If it is absent and you intend to create it, from PowerShell in the collector directory run `.\setup_collector_secret.ps1 -ProjectId ozen-board -ConfirmCreateOrRotate`. The script generates a random value, sends it to Firebase CLI using a temporary file that it deletes, and stores the local counterpart encrypted with Windows DPAPI for the current Windows user. Do not run it if the secret already exists unless you deliberately intend to rotate it.
2. Review rights and add only a confirmed source. The local test source and sender are already configured; images are disabled. For any further source, add its chat to collector `chats` and add a matching non-empty entry to `allowed_sender_ids`; add it to `image_chat_ids` only if image transfer is covered by the permission. In Functions runtime configuration, set `TELEGRAM_LISTINGS_IMPORT_ENABLED=true` and provide the same source in `TELEGRAM_LISTINGS_CHATS_JSON` with exact public username/type, `allowedSenderIds`, rights reference/review timestamp, `permissionConfirmed: true`, permitted `rightsFields`, category mappings, and explicit per-source `autoPublish`. Do not invent the rights reference or review date. Keep global and source auto-publish false until that specific source's permission and first review-only test are confirmed.
3. First inspect the existing local session without logging in again. In PowerShell, run `.\run_collector.ps1 -Mode check-and-list`. It prompts for `TELEGRAM_API_ID` and securely prompts for `TELEGRAM_API_HASH` only if they are absent from the current shell. It first prints only session authorization state, then lists accessible group/channel IDs, types and public usernames/links; it does not print titles, message text, phone or account ID. Membership is not permission to republish. If unauthorized, `.\run_collector.ps1 -Mode login` opens a Telegram QR code. Scan it in Telegram → Settings → Devices → Link Desktop Device. If Telegram requests a 2-step password, the prompt is hidden; enter it locally. Never send login codes/passwords to chat. The QR image is deleted after a successful login.
4. Deploy only the two changed request functions after reviewing the production source settings and confirming the new secret exists:

   ```powershell
   firebase deploy --only functions:telegramCollectorIngest,functions:telegramListingsWebhook --project ozen-board
   ```

   This does not register, replace or delete the Telegram Bot API webhook. Read the deployed `telegramCollectorIngest` HTTPS URL from the Firebase/Google Cloud function details and pass it to the local process; do not guess the generated URL.
5. Before the first collector run, set global and per-source auto-publish false. Run a single synthetic post only in a source where reuse of that synthetic content has been explicitly authorized. Start `.\run_collector.ps1 -Endpoint '<deployed HTTPS URL>'`. Confirm a single `pending_review` record through the existing admin moderation page or trusted server-side tooling, inspect the original link/fields/image, then approve or reject using existing moderation. Do not bulk-replay the historical candidate journal. After a source-specific review-only test and rights confirmation, enable auto-publish only for that source; the parser still forces uncertain posts into review.
6. Check fixed result logs and the local outbox summary. Transient failures remain pending. Permanent failures and server-skipped records remain on disk; after correcting configuration, run `python collector.py --retry-failed` or `python collector.py --retry-skipped` from the collector directory. These commands do not scan Telegram history; they retry only retained outbox rows.

The endpoint is public at the network layer because an owner-run collector cannot use Google IAM identity by default; every request must pass HMAC verification, timestamp freshness, strict schema validation, chat/source allowlist and sender allowlist. Rotate the HMAC secret only deliberately, update the DPAPI local copy in the same setup process, and redeploy the ingress so the new Secret Manager version is bound. Removing the Bot API webhook is unrelated and is not required for the collector. To stop collection, stop the local process and set the Telegram import switch false; existing public Telegram ads are not automatically hidden by stopping intake.

## Billing and operational risks

Deploying Functions v2 requires the project's billing configuration to support Cloud Functions. Possible charges include function invocations, CPU/memory time, networking, image/container builds and Artifact Registry storage. Firestore reads, writes, deletes, storage and TTL-driven deletions may also incur costs. Quotas and pricing change; check the current Firebase and Google Cloud billing pages for `ozen-board` before enabling an active source. Rate limits and the 20-new-record daily cap constrain volume but do not guarantee a zero bill.

Relevant official references: [Telegram Bot API](https://core.telegram.org/bots/api), [Telegram message links](https://core.telegram.org/api/links), [Firebase Functions v2 HTTPS options](https://firebase.google.com/docs/reference/functions/2nd-gen/node/firebase-functions.https.httpsoptions), [deploy specific Cloud Functions](https://firebase.google.com/docs/functions/manage-functions), [Functions environment configuration](https://firebase.google.com/docs/functions/config-env), [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Firebase pricing](https://firebase.google.com/pricing), and [Firestore pricing](https://cloud.google.com/firestore/pricing).

## Current status

No live Firebase or Telegram mutation has been made by this implementation work. Firebase CLI authentication and project visibility were checked read-only; `gcloud` is unavailable, and deployed runtime flags/source configuration could not be inspected safely with the available tools. The production auto-publish state and rights allowlist therefore remain unverified. The existing Bot API/webhook secrets were not read or changed. `TELEGRAM_COLLECTOR_HMAC_SECRET` has not been created or read. No webhook was registered/deleted, no source was added, no collector was run against Telegram, and no deploy was performed. The first end-to-end test requires the owner to confirm rights, inspect runtime source/auto-publish configuration, prepare the HMAC secret, deploy the two named functions, and provide the generated ingress URL locally.
