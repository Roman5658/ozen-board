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

type AuctionBid = {
    id: string
    userId: string
    userName: string
    amount: number
    createdAt: number
}

function AuctionPage() {
    const navigate = useNavigate()
    const { id } = useParams<{ id?: string }>()

    const [now] = useState(() => Date.now())

    // UI
    const [city, setCity] = useState<'all' | string>('all')
    const [sort, setSort] = useState<'time' | 'bid'>('time')

    // DATA
    const [auctions, setAuctions] = useState<Auction[]>([])
    const [activeAuction, setActiveAuction] = useState<Auction | null>(null)
    const [bids, setBids] = useState<AuctionBid[]>([])
    const [loading, setLoading] = useState(true)

    // i18n
    const lang = (localStorage.getItem('lang') as Lang) || DEFAULT_LANG
    const t = translations[lang]

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
        if (!id) {
            setActiveAuction(null)
            setBids([])
            return
        }

        const auctionId = id // 🔥 здесь id уже string

        async function openAuction() {
            await loadAuctionById(auctionId)
            await loadBids(auctionId)
            await finalizeAuction(auctionId)
            await loadAuctionById(auctionId)
            await loadBids(auctionId)
        }

        openAuction()
    }, [id])

    // =========================
    // AUTH
    // =========================
    const user = getLocalUser()
    const isAuthenticated = !!user

    // =========================
    // FILTERED LIST
    // =========================
    const filteredAuctions = useMemo(() => {
        const active = auctions.filter(a => a.endsAt > now)
        const ended = auctions.filter(a => a.endsAt <= now)

        const isAllCities = city === "all"

        const inCity = (a: Auction) => isAllCities || a.city === city

        const top = active.filter(
            a =>
                a.promotionType === "top-auction" &&
                a.promotionUntil &&
                a.promotionUntil > now &&
                inCity(a)
        )

        const featured = active.filter(
            a =>
                a.promotionType === "featured" &&
                a.promotionUntil &&
                a.promotionUntil > now &&
                inCity(a)
        )

        const normal = active.filter(
            a =>
                a.promotionType !== "top-auction" &&
                a.promotionType !== "featured" &&
                inCity(a)
        )

        // 🔥 если вся страна — ограничиваем TOP
        const limitedTop = isAllCities ? top.slice(0, 5) : top

        return [
            ...limitedTop,
            ...featured,
            ...normal.sort((a, b) => {
                if (sort === "bid") return b.currentBid - a.currentBid
                return a.endsAt - b.endsAt
            }),
            ...ended,
        ]
    }, [auctions, city, sort, now])


    if (loading) {
        return <div className="card">Завантаження аукціонів…</div>
    }
    const topAuctions = filteredAuctions.filter(
        a =>
            a.promotionType === "top-auction" &&
            a.promotionUntil &&
            a.promotionUntil > now
    )

    const featuredAuctions = filteredAuctions.filter(
        a =>
            a.promotionType === "featured" &&
            a.promotionUntil &&
            a.promotionUntil > now
    )

    const regularAuctions = filteredAuctions.filter(
        a =>
            a.promotionType === "none" ||
            a.promotionType === "highlight-gold" ||
            !a.promotionType
    )


    // =========================
    // RENDER
    // =========================
    return (
        <div>
            <h2>{t.auctionTitle}</h2>

            {activeAuction ? (
                <AuctionDetails
                    auctionId={activeAuction.id}
                    title={activeAuction.title}
                    city={activeAuction.city}
                    description={activeAuction.description}
                    images={activeAuction.images}
                    currentBid={activeAuction.currentBid}
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
                />
            ) : (
                <>
                    <div style={{marginBottom: 12}}>
                        <select value={city} onChange={e => setCity(e.target.value)} className="input">
                            <option value="all">Всі міста</option>
                            {[...new Set(auctions.map(a => a.city))].map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>

                        <select
                            value={sort}
                            onChange={e => setSort(e.target.value as 'time' | 'bid')}
                            className="input"
                        >
                            <option value="time">За часом</option>
                            <option value="bid">За ставкою</option>
                        </select>

                    </div>

                    <div className="ads-grid">

                        {topAuctions.length > 0 && (
                            <div className="ads-separator">🔥 TOP аукціони</div>
                        )}
                        {topAuctions.map(item => (
                            <div key={item.id} onClick={() => navigate(`/auction/${item.id}`)}>
                                <AuctionCard
                                    title={item.title}
                                    city={item.city}
                                    currentBid={item.currentBid}
                                    timeLeft={getTimeLeft(item.endsAt)}
                                    image={item.images[0]}
                                    isEnded={item.endsAt <= now}
                                    promotionType={item.promotionType}
                                />
                            </div>
                        ))}

                        {featuredAuctions.length > 0 && (
                            <div className="ads-separator">⭐ Featured</div>
                        )}
                        {featuredAuctions.map(item => (
                            <div key={item.id} onClick={() => navigate(`/auction/${item.id}`)}>
                                <AuctionCard
                                    title={item.title}
                                    city={item.city}
                                    currentBid={item.currentBid}
                                    timeLeft={getTimeLeft(item.endsAt)}
                                    image={item.images[0]}
                                    isEnded={item.endsAt <= now}
                                    promotionType={item.promotionType}
                                />
                            </div>
                        ))}

                        {regularAuctions.length > 0 && (
                            <div className="ads-separator">📄 Інші аукціони</div>
                        )}
                        {regularAuctions.map(item => (
                            <div key={item.id} onClick={() => navigate(`/auction/${item.id}`)}>
                                <AuctionCard
                                    title={item.title}
                                    city={item.city}
                                    currentBid={item.currentBid}
                                    timeLeft={getTimeLeft(item.endsAt)}
                                    image={item.images[0]}
                                    isEnded={item.endsAt <= now}
                                    promotionType={item.promotionType}
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
