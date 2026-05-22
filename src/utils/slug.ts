const transliterationMap: Record<string, string> = {
    // Polish
    'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
    // Ukrainian
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ye',
    'ж': 'zh', 'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'yi', 'й': 'y', 'к': 'k', 'л': 'l',
    'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '', 'ю': 'yu', 'я': 'ya',
}

function transliterate(value: string): string {
    return value
        .toLowerCase()
        .split('')
        .map((char) => transliterationMap[char] ?? char)
        .join('')
}

function slugifyPart(value?: string): string {
    if (!value) return ''

    return transliterate(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
}

export function createSlug(title: string, city: string, id: string): string {
    const titlePart = slugifyPart(title)
    const cityPart = slugifyPart(city)
    const parts = [titlePart, cityPart, id].filter(Boolean)
    return parts.join('-')
}

export function extractIdFromSlug(value?: string): string | null {
    if (!value) return null
    const parts = value.split('-').filter(Boolean)
    return parts.length > 0 ? parts[parts.length - 1] : null
}

export function buildAdPath(title: string, city: string, id: string): string {
    return `/ad/${createSlug(title, city, id)}`
}

export function buildAuctionPath(title: string, city: string, id: string): string {
    return `/auction/${createSlug(title, city, id)}`
}