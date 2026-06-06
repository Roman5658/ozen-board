import { useEffect } from 'react'

const BASE_URL = 'https://xoven.pl'
const DEFAULT_IMAGE = `${BASE_URL}/apple-touch-icon.png`

type SeoPayload = {
    title: string
    description: string
    path: string
    lang: 'pl' | 'uk'
    enabled?: boolean
    image?: string
    ogType?: 'website' | 'product'
    alternates?: Array<{ hreflang: string; href: string }>
    noindex?: boolean
    jsonLd?: object | object[]
}

function normalizeSeoText(value?: string): string {
    return (value ?? '').replace(/\s+/g, ' ').trim()
}

function truncateSeoText(value: string, maxLength: number): string {
    const normalized = normalizeSeoText(value)
    if (normalized.length <= maxLength) return normalized

    const sliced = normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()
    const wordBoundary = sliced.lastIndexOf(' ')
    const text = wordBoundary >= Math.floor(maxLength * 0.6)
        ? sliced.slice(0, wordBoundary)
        : sliced

    return `${text.replace(/[.,;:!?-]+$/g, '')}…`
}

export function buildSeoDescription(
    content: string | undefined,
    details: Array<string | undefined>,
    fallback: string,
    maxLength = 160,
): string {
    const base = normalizeSeoText(content) || normalizeSeoText(fallback)
    const suffixParts = details.map(normalizeSeoText).filter(Boolean)
    const suffix = suffixParts.length > 0 ? `${suffixParts.join('. ')}.` : ''

    if (!suffix) return truncateSeoText(base, maxLength)

    const baseLimit = maxLength - suffix.length - 1
    if (baseLimit < 20) {
        return truncateSeoText(`${base} ${suffix}`, maxLength)
    }

    return `${truncateSeoText(base, baseLimit)} ${suffix}`
}

function normalizePath(path: string) {
    return path === '/' ? '/' : path.replace(/\/+$/, '')
}

function setOrCreateMeta(attr: 'name' | 'property', key: string, content: string) {
    let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null
    if (!el) {
        el = document.createElement('meta')
        el.setAttribute(attr, key)
        document.head.appendChild(el)
    }
    el.setAttribute('content', content)
}

function setOrCreateLink(rel: string, href: string, hreflang?: string) {
    const selector = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]:not([hreflang])`
    let el = document.head.querySelector(selector) as HTMLLinkElement | null
    if (!el) {
        el = document.createElement('link')
        el.setAttribute('rel', rel)
        if (hreflang) el.setAttribute('hreflang', hreflang)
        document.head.appendChild(el)
    }
    el.setAttribute('href', href)
}

function setJsonLd(data?: object | object[]) {
    const existing = document.head.querySelector('script[data-seo-jsonld="1"]')
    if (existing) existing.remove()
    if (!data) return

    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.setAttribute('data-seo-jsonld', '1')
    script.text = JSON.stringify(data)
    document.head.appendChild(script)
}

export function useSeo(payload: SeoPayload) {
    useEffect(() => {
        if (payload.enabled === false) return

        document.documentElement.lang = payload.lang
        document.title = payload.title

        const normalizedPath = normalizePath(payload.path)
        const url = `${BASE_URL}${normalizedPath}`
        const image = payload.image || DEFAULT_IMAGE
        const ogLocale = payload.lang === 'pl' ? 'pl_PL' : 'uk_UA'
        const alternateLocale = payload.lang === 'pl' ? 'uk_UA' : 'pl_PL'

        setOrCreateMeta('name', 'description', payload.description)
        setOrCreateMeta('name', 'keywords', 'ogłoszenia, darmowe ogłoszenia, aukcje, usługi, wynajem, praca, оголошення, послуги, оренда, объявления, работа')
        setOrCreateMeta('name', 'robots', payload.noindex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1')
        setOrCreateMeta('property', 'og:site_name', 'Xoven')
        setOrCreateMeta('property', 'og:title', payload.title)
        setOrCreateMeta('property', 'og:description', payload.description)
        setOrCreateMeta('property', 'og:image', image)
        setOrCreateMeta('property', 'og:url', url)
        setOrCreateMeta('property', 'og:locale', ogLocale)
        setOrCreateMeta('property', 'og:locale:alternate', alternateLocale)
        setOrCreateMeta('property', 'og:type', payload.ogType ?? 'website')
        setOrCreateMeta('name', 'twitter:card', 'summary_large_image')
        setOrCreateMeta('name', 'twitter:title', payload.title)
        setOrCreateMeta('name', 'twitter:description', payload.description)
        setOrCreateMeta('name', 'twitter:image', image)

        setOrCreateLink('canonical', url)

        document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach(el => el.remove())
        const alternates = payload.alternates ?? []
        for (const alt of alternates) {
            setOrCreateLink('alternate', alt.href, alt.hreflang)
        }

        setJsonLd(payload.jsonLd)
    }, [payload])
}

export { BASE_URL }
