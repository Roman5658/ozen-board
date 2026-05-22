import { useEffect } from 'react'

const BASE_URL = 'https://xoven.pl'
const DEFAULT_IMAGE = `${BASE_URL}/vite.svg`

type SeoPayload = {
    title: string
    description: string
    path: string
    lang: 'pl' | 'uk'
    alternates?: Array<{ hreflang: string; href: string }>
    jsonLd?: object | object[]
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
        document.documentElement.lang = payload.lang
        document.title = payload.title

        const url = `${BASE_URL}${payload.path}`

        setOrCreateMeta('name', 'description', payload.description)
        setOrCreateMeta('name', 'keywords', 'ogłoszenia, darmowe ogłoszenia, aukcje, usługi, wynajem, praca, оголошення в Польщі, послуги, оренда, объявления в Польше, работа в Польше')
        setOrCreateMeta('property', 'og:title', payload.title)
        setOrCreateMeta('property', 'og:description', payload.description)
        setOrCreateMeta('property', 'og:image', DEFAULT_IMAGE)
        setOrCreateMeta('property', 'og:url', url)
        setOrCreateMeta('property', 'og:type', 'website')
        setOrCreateMeta('name', 'twitter:card', 'summary_large_image')

        setOrCreateLink('canonical', url)

        const alternates = payload.alternates ?? []
        for (const alt of alternates) {
            setOrCreateLink('alternate', alt.href, alt.hreflang)
        }

        setJsonLd(payload.jsonLd)
    }, [payload])
}

export { BASE_URL }