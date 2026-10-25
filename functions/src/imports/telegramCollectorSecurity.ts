import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const MIN_SECRET_BYTES = 32;

export function signTelegramCollectorBody(secret: string, timestamp: string, body: Buffer): string {
    return createHmac("sha256", secret).update(timestamp).update(".").update(body).digest("hex");
}

export function isAuthorizedTelegramCollectorRequest(
    secret: string,
    timestampHeader: string | undefined,
    signatureHeader: string | undefined,
    rawBody: Buffer,
    nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
    if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES || !timestampHeader || !signatureHeader) return false;
    if (!/^\d{10}$/.test(timestampHeader) || !/^[a-f0-9]{64}$/i.test(signatureHeader)) return false;
    const timestamp = Number(timestampHeader);
    if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) return false;
    const expected = Buffer.from(signTelegramCollectorBody(secret, timestampHeader, rawBody), "hex");
    const supplied = Buffer.from(signatureHeader, "hex");
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

/** A stable opaque Firestore ledger key; source IDs and message text are not embedded in it. */
export function createTelegramCollectorUpdateKey(rawBody: Buffer): string {
    return `collector_${createHash("sha256").update(rawBody).digest("hex")}`;
}
