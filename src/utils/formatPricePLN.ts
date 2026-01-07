// src/utils/formatPricePLN.ts
export function formatPricePLN(input?: string | number | null) {
    if (input === null || input === undefined) return ""

    // Приводим к строке и чистим пробелы
    const raw = String(input).trim()
    if (!raw) return ""

    // Если валюта уже указана — не трогаем
    // (zł, pln, PLN, zł.)
    if (/\b(pln)\b/i.test(raw) || /zł/i.test(raw)) return raw

    // Если это просто число (или число с пробелами/запятыми) — добавляем zł
    // Примеры: "252", "252.50", "252,50"
    const normalized = raw.replace(/\s+/g, "").replace(",", ".")
    const num = Number(normalized)

    if (!Number.isNaN(num)) {
        // Оставляем исходное написание (если было "252,50" — пусть будет так)
        return `${raw} zł`
    }

    // Если это не число (например "договірна") — возвращаем как есть
    return raw
}
