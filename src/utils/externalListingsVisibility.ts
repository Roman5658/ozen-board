export function isExternalListingsConfigEnabled(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return (value as Record<string, unknown>).enabled === true;
}

export function isTelegramListingsConfigEnabled(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const config = value as Record<string, unknown>;
    return config.enabled === true && config.telegramEnabled === true;
}

export function isTelegramExternalSource(sourceId: unknown): boolean {
    return typeof sourceId === "string" && /^telegram_[a-f0-9]{20}$/.test(sourceId);
}

export function shouldShowExternalSource(sourceId: unknown, telegramEnabled: boolean): boolean {
    return telegramEnabled || !isTelegramExternalSource(sourceId);
}
