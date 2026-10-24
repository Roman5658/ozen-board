import { timingSafeEqual } from "node:crypto";

/** Telegram webhook secrets are compared without logging or timing-dependent string equality. */
export function isAuthorizedTelegramWebhookSecret(expected: string, supplied: string | undefined): boolean {
    if (!expected || !supplied) return false;
    const expectedBytes = Buffer.from(expected);
    const suppliedBytes = Buffer.from(supplied);
    return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}
