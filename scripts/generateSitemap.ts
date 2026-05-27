import { writeFile } from "node:fs/promises"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { initializeApp } from "firebase/app"
import {
    collection,
    getDocs,
    getFirestore,
    limit,
    query,
    where,
    type DocumentData,
    type Firestore,
    type QueryDocumentSnapshot,
} from "firebase/firestore"
import { buildAdPath, buildAuctionPath } from "../src/utils/slug"

const BASE_URL = "https://xoven.pl"
const ADS_LIMIT = 1000
const AUCTIONS_LIMIT = 500

type SitemapUrl = {
    loc: string
    lastmod?: string
}

const staticUrls: SitemapUrl[] = [
    { loc: "/" },
    { loc: "/pl/" },
    { loc: "/uk/" },
    { loc: "/pl/ogloszenia" },
    { loc: "/pl/aukcje" },
    { loc: "/uk/ogoloshennya" },
    { loc: "/uk/auktsiony" },
    { loc: "/safety" },
    { loc: "/pl/bezpieczenstwo" },
    { loc: "/uk/bezpeka" },
    { loc: "/promotion-info" },
    { loc: "/privacy" },
    { loc: "/terms" },
    { loc: "/cookies" },
    { loc: "/contact" },
]

function readDotEnvValue(key: string): string | undefined {
    const envPath = join(process.cwd(), ".env")
    if (!existsSync(envPath)) return undefined

    const lines = readFileSync(envPath, "utf8").split(/\r?\n/)
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue

        const separatorIndex = trimmed.indexOf("=")
        if (separatorIndex <= 0) continue

        const name = trimmed.slice(0, separatorIndex).trim()
        if (name !== key) continue

        return trimmed
            .slice(separatorIndex + 1)
            .trim()
            .replace(/^["']|["']$/g, "")
    }

    return undefined
}

function readConfigValue(key: string): string {
    const value = process.env[key] || readDotEnvValue(key)
    if (!value) {
        throw new Error(`Missing ${key}. Add it to .env before generating sitemap.`)
    }

    return value
}

function getDb(): Firestore {
    const app = initializeApp({
        apiKey: readConfigValue("VITE_FIREBASE_API_KEY"),
        authDomain: readConfigValue("VITE_FIREBASE_AUTH_DOMAIN"),
        projectId: readConfigValue("VITE_FIREBASE_PROJECT_ID"),
        storageBucket: readConfigValue("VITE_FIREBASE_STORAGE_BUCKET"),
        messagingSenderId: readConfigValue("VITE_FIREBASE_MESSAGING_SENDER_ID"),
        appId: readConfigValue("VITE_FIREBASE_APP_ID"),
    })

    return getFirestore(app)
}

function toAbsoluteUrl(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) return path
    const normalizedPath = path.startsWith("/") ? path : `/${path}`
    return `${BASE_URL}${normalizedPath}`
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
}

function toDate(value: unknown): Date | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        const millis = value > 100_000_000_000 ? value : value * 1000
        const date = new Date(millis)
        return Number.isNaN(date.getTime()) ? null : date
    }

    if (value && typeof value === "object") {
        const maybeTimestamp = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
        if (typeof maybeTimestamp.toDate === "function") {
            const date = maybeTimestamp.toDate()
            return Number.isNaN(date.getTime()) ? null : date
        }

        const seconds = maybeTimestamp._seconds ?? maybeTimestamp.seconds
        if (typeof seconds === "number" && Number.isFinite(seconds)) {
            const date = new Date(seconds * 1000)
            return Number.isNaN(date.getTime()) ? null : date
        }
    }

    return null
}

function getLastmod(data: DocumentData): string | undefined {
    const date = toDate(data.updatedAt) ?? toDate(data.createdAt)
    return date?.toISOString()
}

function isSeeded(data: DocumentData): boolean {
    return data.seeded === true || data.createdBySeedScript === true
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0
}

function sitemapEntry(url: SitemapUrl): string {
    const lastmod = url.lastmod ? `\n        <lastmod>${escapeXml(url.lastmod)}</lastmod>` : ""
    return `    <url>\n        <loc>${escapeXml(toAbsoluteUrl(url.loc))}</loc>${lastmod}\n    </url>`
}

function renderSitemap(urls: SitemapUrl[]): string {
    const seen = new Set<string>()
    const uniqueUrls = urls.filter(url => {
        const loc = toAbsoluteUrl(url.loc)
        if (seen.has(loc)) return false
        seen.add(loc)
        return true
    })

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...uniqueUrls.map(sitemapEntry),
        '</urlset>',
        '',
    ].join("\n")
}

async function loadActiveAds(db: Firestore): Promise<SitemapUrl[]> {
    const snap = await getDocs(query(
        collection(db, "ads"),
        where("status", "==", "active"),
        limit(ADS_LIMIT),
    ))

    return snap.docs.flatMap((docSnap: QueryDocumentSnapshot): SitemapUrl[] => {
        const data = docSnap.data()
        if (isSeeded(data)) return []
        if (!isNonEmptyString(data.title) || !isNonEmptyString(data.city)) return []

        return [{
            loc: buildAdPath(data.title, data.city, docSnap.id),
            lastmod: getLastmod(data),
        }]
    })
}

async function loadActiveAuctions(db: Firestore, now: number): Promise<SitemapUrl[]> {
    const snap = await getDocs(query(
        collection(db, "auctions"),
        where("status", "==", "active"),
        limit(AUCTIONS_LIMIT),
    ))

    return snap.docs.flatMap((docSnap: QueryDocumentSnapshot): SitemapUrl[] => {
        const data = docSnap.data()
        if (isSeeded(data)) return []
        if (!isNonEmptyString(data.title) || !isNonEmptyString(data.city)) return []
        if (typeof data.endsAt !== "number" || data.endsAt <= now) return []

        return [{
            loc: buildAuctionPath(data.title, data.city, docSnap.id),
            lastmod: getLastmod(data),
        }]
    })
}

async function main() {
    const db = getDb()
    const now = Date.now()

    const [adUrls, auctionUrls] = await Promise.all([
        loadActiveAds(db),
        loadActiveAuctions(db, now),
    ])

    const sitemap = renderSitemap([
        ...staticUrls,
        ...adUrls,
        ...auctionUrls,
    ])

    const outputPath = join(process.cwd(), "public", "sitemap.xml")
    await writeFile(outputPath, sitemap, "utf8")

    console.log(`Generated public/sitemap.xml`)
    console.log(`Static URLs: ${staticUrls.length}`)
    console.log(`Active ad URLs: ${adUrls.length}`)
    console.log(`Active auction URLs: ${auctionUrls.length}`)
}

main().catch(error => {
    console.error("[sitemap] generation failed")
    console.error(error)
    process.exitCode = 1
})
