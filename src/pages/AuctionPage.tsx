import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
    collection,
    getDocs,
    doc,
    getDoc,
    query,
    orderBy,
} from 'firebase/firestore'
import { finalizeAuction } from '../data/finalizeAuction'

import AuctionCard from '../components/AuctionCard'
import AuctionDetails from '../components/AuctionDetails'

import { db } from '../app/firebase'
import { getLocalUser } from '../data/localUser'

import { getTimeLeft } from '../utils/time'
import { translations, DEFAULT_LANG } from '../app/i18n'
import type { Lang } from '../app/i18n'
import type { Auction } from '../types/auction'
import { buildAuctionPath, extractIdFromSlug } from '../utils/slug'
import { useSeo, BASE_URL } from '../utils/seo'

type AuctionBid = {
    id: string
    userId: string
    userName: string
    amount: number
    createdAt: number
}

function AuctionPage() {
    const navigate = useNavigate()
    const { id: slugOrId } = useParams<{ id?: string }>()

    const [now] = useState(() => Date.now())

    // UI
    const [city, setCity] = useState<'all' | string>('all')
    const [sort, setSort] = useState<'time' | 'bid'>('time')
    const [view, setView] = useState<'list' | 'grid'>(() => {
        const saved = localStorage.getItem('auctionsViewMode')
        return saved === 'list' ? 'list' : 'grid'
    })

    // DATA
    const [auctions, setAuctions] = useState<Auction[]>([])
    const [activeAuction, setActiveAuction] = useState<Auction | null>(null)
    const [bids, setBids] = useState<AuctionBid[]>([])
    const [loading, setLoading] = useState(true)

    // i18n
    const lang = (localStorage.getItem('lang') as Lang) || DEFAULT_LANG
    const t = translations[lang]
    useEffect(() => {
        localStorage.setItem('auctionsViewMode', view)
    }, [view])

    // =========================
    // LOAD AUCTIONS LIST
    // =========================
    useEffect(() => {
        async function loadAuctions() {
            try {
                const snap = await getDocs(collection(db, 'auctions'))
                const data: Auction[] = snap.docs.map(doc => {
                    const raw = doc.data()
                    return {
                        id: doc.id,
                        title: raw.title,
                        description: raw.description,
                        category: raw.category,
                        voivodeship: raw.voivodeship,
                        city: raw.city,
                        startPrice: raw.startPrice,
                        buyNowPrice: raw.buyNowPrice ?? undefined,
                        currentBid: raw.currentBid,
                        images: raw.images ?? [],
                        ownerId: raw.ownerId,
                        ownerName: raw.ownerName,
                        bidsCount: raw.bidsCount ?? 0,
                        status: raw.status ?? 'active',
                        createdAt: raw.createdAt,
                        endsAt: raw.endsAt,
                        winnerId: raw.winnerId ?? null,

                        promotionType: raw.promotionType ?? "none",
                        promotionUntil: raw.promotionUntil ?? null,
                        promotionQueueAt: raw.promotionQueueAt ?? null,
                    }
                })
                setAuctions(data)
            } finally {
                setLoading(false)
            }
        }

        loadAuctions()
    }, [])

    // =========================
    // LOAD ONE AUCTION
    // =========================
    async function loadAuctionById(auctionId: string) {
        const ref = doc(db, 'auctions', auctionId)
        const snap = await getDoc(ref)

        if (!snap.exists()) {
            setActiveAuction(null)
            return
        }

        const raw = snap.data()

        setActiveAuction({
            id: snap.id,
            title: raw.title,
            description: raw.description,
            category: raw.category,
            voivodeship: raw.voivodeship,
            city: raw.city,
            startPrice: raw.startPrice,
            buyNowPrice: raw.buyNowPrice ?? undefined,
            currentBid: raw.currentBid,
            images: raw.images ?? [],
            ownerId: raw.ownerId,
            ownerName: raw.ownerName,
            bidsCount: raw.bidsCount ?? 0,
            status: raw.status ?? 'active',
            createdAt: raw.createdAt,
            endsAt: raw.endsAt,
            winnerId: raw.winnerId ?? null,

            promotionType: raw.promotionType ?? "none",
            promotionUntil: raw.promotionUntil ?? null,
            promotionQueueAt: raw.promotionQueueAt ?? null,

        })
    }

    // =========================
    // LOAD BIDS
    // =========================
    async function loadBids(auctionId: string) {
        const q = query(
            collection(db, 'auctionBids', auctionId, 'bids'),
            orderBy('createdAt', 'desc')
        )

        const snap = await getDocs(q)

        const data: AuctionBid[] = snap.docs.map(doc => {
            const raw = doc.data()
            return {
                id: doc.id,
                userId: raw.userId,
                userName: raw.userName,
                amount: raw.amount,
                createdAt: raw.createdAt,
            }
        })

        setBids(data)
    }

    // =========================
    // OPEN AUCTION BY URL
    // =========================
    useEffect(() => {
        if (!slugOrId) {
            setActiveAuction(null)
            setBids([])
            return
        }

        const auctionIdFromSlug = extractIdFromSlug(slugOrId)
        if (!auctionIdFromSlug) return
        const auctionId = auctionIdFromSlug

        async function openAuction() {
            await loadAuctionById(auctionId)
            await loadBids(auctionId)
            await finalizeAuction(auctionId)
            await loadAuctionById(auctionId)
            await loadBids(auctionId)
        }

        openAuction()
    }, [slugOrId])

    useEffect(() => {
        if (!slugOrId || !activeAuction) return
        const canonicalPath = buildAuctionPath(activeAuction.title, activeAuction.city, activeAuction.id)
        if (`/auction/${slugOrId}` !== canonicalPath) {
            navigate(canonicalPath, { replace: true })
        }
    }, [slugOrId, activeAuction, navigate])
    const seoLang = (localStorage.getItem('lang') === 'pl' ? 'pl' : 'uk') as 'pl' | 'uk'
    useSeo({
        title: activeAuction
            ? (seoLang === 'pl' ? `${activeAuction.title} ${activeAuction.city} | Xoven` : `Купити ${activeAuction.title} ${activeAuction.city} | Xoven`)
            : (seoLang === 'pl' ? 'Aukcje | Xoven' : 'Аукціони | Xoven'),
        description: activeAuction
            ? (seoLang === 'pl'
                ? `Licytuj lokalnie. Zobacz aukcję: ${activeAuction.title} w ${activeAuction.city}.`
                : `Бери участь в локальних аукціонах. Переглянь лот: ${activeAuction.title} у ${activeAuction.city}.`)
            : (seoLang === 'pl' ? 'Aukcje lokalne.' : 'Локальні аукціони.'),
        path: activeAuction ? `/auction/${slugOrId ?? activeAuction.id}` : '/auctions',
        lang: seoLang,
        alternates: [
            { hreflang: 'pl-PL', href: `${BASE_URL}/pl/aukcje` },
            { hreflang: 'uk-UA', href: `${BASE_URL}/uk/auktsiony` },
            { hreflang: 'x-default', href: `${BASE_URL}/pl/aukcje` },
        ],
        jsonLd: activeAuction ? {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: activeAuction.title,
            description: activeAuction.description,
            offers: {
                '@type': 'Offer',
                priceCurrency: 'PLN',
                price: activeAuction.currentBid,
                availability: 'https://schema.org/InStock',
            },
        } : undefined,
    })

    // =========================
    // AUTH
    // =========================
    const user = getLocalUser()
    const isAuthenticated = !!user

    // =========================
    // FILTERED LIST
    // =========================
    const {
        topAuctionsVisible,
        featuredAuctionsVisible,
        regularAuctions,
    } = useMemo(() => {
        // 1️⃣ только активные аукционы
        const activeAuctions = auctions.filter(
            a => a.status === "active" && a.endsAt > now
        )

        // 2️⃣ фильтр по городу
        const inCity = (a: Auction) =>
            city === "all" || a.city === city

        // 3️⃣ все активные TOP
        const topAuctionsAll = activeAuctions.filter(
            a =>
                a.promotionType === "top-auction" &&
                a.promotionUntil &&
                a.promotionUntil > now &&
                inCity(a)
        )

        // 4️⃣ все активные FEATURED
        const featuredAuctionsAll = activeAuctions.filter(
            a =>
                a.promotionType === "featured" &&
                a.promotionUntil &&
                a.promotionUntil > now &&
                inCity(a)
        )

        // 5️⃣ витрина (лимиты)
        const topAuctionsVisible =
            city === "all"
                ? shuffle(topAuctionsAll).slice(0, 3)
                : topAuctionsAll.slice(0, 3)

        const featuredAuctionsVisible =
            city === "all"
                ? shuffle(featuredAuctionsAll).slice(0, 6)
                : featuredAuctionsAll.slice(0, 6)

        // 6️⃣ ID показанных аукционов
        const visiblePromotionIds = new Set([
            ...topAuctionsVisible.map(a => a.id),
            ...featuredAuctionsVisible.map(a => a.id),
        ])

        // 7️⃣ обычные — НИЧЕГО НЕ ПРОПАДАЕТ
        const regularAuctions = activeAuctions
            .filter(a => inCity(a))
            .filter(a => !visiblePromotionIds.has(a.id))
            .sort((a, b) => {
                if (sort === "bid") return b.currentBid - a.currentBid
                return a.endsAt - b.endsAt
            })

        return {
            topAuctionsVisible,
            featuredAuctionsVisible,
            regularAuctions,
        }
    }, [auctions, city, sort, now])

    const visibleAuctionIds = useMemo(() => {
        return new Set([
            ...topAuctionsVisible.map(a => a.id),
            ...featuredAuctionsVisible.map(a => a.id),
        ])
    }, [topAuctionsVisible, featuredAuctionsVisible])

    function shuffle<T>(arr: T[]): T[] {
        return [...arr].sort(() => Math.random() - 0.5)
    }


    if (loading) {
        return <div className="card">{t.auctions.loading}</div>
    }




    // =========================
    // RENDER
    // =========================
    return (
        <div>
            <h2>{t.auctionTitle}</h2>

            {activeAuction ? (
                <AuctionDetails
                    t={t}
                    auctionId={activeAuction.id}
                    title={activeAuction.title}
                    city={activeAuction.city}
                    description={activeAuction.description}
                    images={activeAuction.images}
                    currentBid={activeAuction.currentBid}
                    promotionType={activeAuction.promotionType}
                    promotionUntil={activeAuction.promotionUntil ?? null}
                    promotionQueueAt={activeAuction.promotionQueueAt ?? null}
                    timeLeft={getTimeLeft(activeAuction.endsAt)}
                    bids={bids}
                    isAuthenticated={isAuthenticated}
                    onBack={() => navigate('/auctions')}
                    seller={{
                        id: activeAuction.ownerId,
                        name: activeAuction.ownerName,
                        karma: 0,
                    }}
                    currentUserId={user?.id ?? null}
                    onBidSuccess={() => {
                        loadAuctionById(activeAuction.id)
                        loadBids(activeAuction.id)
                    }}
                    onPromotionSuccess={() => {
                        loadAuctionById(activeAuction.id)
                    }}
                />

            ) : (
                <>
                    <div style={{marginBottom: 12}}>
                        <select value={city} onChange={e => setCity(e.target.value)} className="input">
                            <option value="all">{t.auctions.allCities}</option>

                            {[...new Set(auctions.map(a => a.city))].map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>

                        <select
                            value={sort}
                            onChange={e => setSort(e.target.value as 'time' | 'bid')}
                            className="input"
                        >
                            <option value="time">{t.auctions.sortTime}</option>
                            <option value="bid">{t.auctions.sortBid}</option>

                        </select>
                        <div style={{display: 'flex', gap: 8, marginTop: 8}}>
                            <button
                                className={view === 'list' ? 'btn-primary' : 'btn-secondary'}
                                onClick={() => setView('list')}
                            >
                                {t.home.viewList}
                            </button>
                            <button
                                className={view === 'grid' ? 'btn-primary' : 'btn-secondary'}
                                onClick={() => setView('grid')}
                            >
                                {t.home.viewGrid}
                            </button>
                        </div>

                    </div>

                    <div className={`ads-grid ${view === 'list' ? 'ads-grid--list' : 'ads-grid--grid'}`}>

                        {topAuctionsVisible.length > 0 && (
                            <div className="ads-separator">🔥 {t.auctions.top}</div>
                        )}
                        {topAuctionsVisible.map(item => (
                            <div key={item.id}
                                 onClick={() => navigate(buildAuctionPath(item.title, item.city, item.id))}>
                                <AuctionCard
                                    t={t}
                                    title={item.title}
                                    city={item.city}
                                    currentBid={item.currentBid}
                                    timeLeft={getTimeLeft(item.endsAt)}
                                    image={item.images[0]}
                                    isEnded={item.endsAt <= now}
                                    promotionType={item.promotionType}
                                    isSoftPinned={
                                        (item.promotionType === "top-auction" ||
                                            item.promotionType === "featured") &&
                                        !visibleAuctionIds.has(item.id)
                                    }
                                />

                            </div>
                        ))}


                        {featuredAuctionsVisible.length > 0 && (
                            <div className="ads-separator">⭐ {t.auctions.featured}</div>
                        )}
                        {featuredAuctionsVisible.map(item => (
                            <div key={item.id}
                                 onClick={() => navigate(buildAuctionPath(item.title, item.city, item.id))}>
                                <AuctionCard
                                    t={t}
                                    title={item.title}
                                    city={item.city}
                                    currentBid={item.currentBid}
                                    timeLeft={getTimeLeft(item.endsAt)}
                                    image={item.images[0]}
                                    isEnded={item.endsAt <= now}
                                    promotionType={item.promotionType}
                                    isSoftPinned={
                                        (item.promotionType === "top-auction" ||
                                            item.promotionType === "featured") &&
                                        !visibleAuctionIds.has(item.id)
                                    }
                                />
                            </div>
                        ))}


                        {regularAuctions.length > 0 && (
                            <div className="ads-separator">📄 {t.auctions.regular}</div>
                        )}
                        {regularAuctions.map(item => (
                            <div
                                key={item.id}
                                onClick={() => navigate(buildAuctionPath(item.title, item.city, item.id))}
                            >
                                <AuctionCard
                                    t={t}
                                    title={item.title}
                                    city={item.city}
                                    currentBid={item.currentBid}
                                    timeLeft={getTimeLeft(item.endsAt)}
                                    image={item.images[0]}
                                    isEnded={item.endsAt <= now}
                                    promotionType={item.promotionType}
                                    isSoftPinned={
                                        (item.promotionType === "top-auction" ||
                                            item.promotionType === "featured") &&
                                        !visibleAuctionIds.has(item.id)
                                    }
                                />
                            </div>
                        ))}


                    </div>

                </>
            )}
        </div>
    )
}

export default AuctionPage
