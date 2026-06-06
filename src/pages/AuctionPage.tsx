import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
    collection,
    getDocs,
    doc,
    getDoc,
    query,
    orderBy,
    where,
    limit,
    startAfter,
    type DocumentData,
    type QueryConstraint,
    type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { finalizeAuction } from '../data/finalizeAuction'

import AuctionCard from '../components/AuctionCard'
import AuctionDetails from '../components/AuctionDetails'

import { db } from '../app/firebase'
import { getLocalUser, isAdmin } from '../data/localUser'
import { getOrCreateChat } from '../data/chats'

import { getTimeLeft } from '../utils/time'
import { translations, DEFAULT_LANG } from '../app/i18n'
import type { Lang } from '../app/i18n'
import type { Auction } from '../types/auction'
import { buildAuctionPath, extractIdFromSlug } from '../utils/slug'
import { buildSeoDescription, useSeo, BASE_URL } from '../utils/seo'
import { formatPricePLN } from '../utils/formatPricePLN'
import { getUserPublicNicknames } from '../data/usersPublic'
import { CITIES_BY_VOIVODESHIP } from '../data/cities'

const AUCTIONS_PAGE_SIZE = 30
const PROMOTED_AUCTIONS_LIMIT = 60
const PROMOTION_ROTATION_INTERVAL_MS = 60 * 60 * 1000

type AuctionBid = {
    id: string
    userId: string
    userName: string
    amount: number
    createdAt: number
}

type AuctionDocLike = {
    id: string
    data: () => DocumentData
}

function auctionFromDoc(docSnap: AuctionDocLike): Auction {
    const raw = docSnap.data()
    return {
        id: docSnap.id,
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
        ownerName: raw.ownerName ?? '',
        ownerNickname: raw.ownerNickname ?? null,
        bidsCount: raw.bidsCount ?? 0,
        status: raw.status ?? 'active',
        createdAt: raw.createdAt,
        endsAt: raw.endsAt,
        winnerId: raw.winnerId ?? null,
        winnerChatId: raw.winnerChatId ?? null,
        winnerChatNotifiedAt: raw.winnerChatNotifiedAt ?? null,
        winnerChatNotificationStatus: raw.winnerChatNotificationStatus ?? null,
        currentBidderId: raw.currentBidderId ?? null,
        currentBidderName: raw.currentBidderName ?? null,

        promotionType: raw.promotionType ?? "none",
        promotionUntil: raw.promotionUntil ?? null,
        promotionQueueAt: raw.promotionQueueAt ?? null,
    }
}

function stableHash(value: string): number {
    let hash = 0
    for (let i = 0; i < value.length; i += 1) {
        hash = Math.imul(31, hash) + value.charCodeAt(i)
    }
    return hash >>> 0
}

function rotatePromotedAuctions(auctions: Auction[], rotationBucket: number): Auction[] {
    return [...auctions].sort((a, b) => {
        const scoreA = stableHash(`${a.id}:${rotationBucket}`)
        const scoreB = stableHash(`${b.id}:${rotationBucket}`)
        return scoreA - scoreB || a.endsAt - b.endsAt || a.id.localeCompare(b.id)
    })
}

function AuctionPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { id: slugOrId } = useParams<{ id?: string }>()

    const [now] = useState(() => Date.now())

    // UI
    const [city, setCity] = useState<'all' | string>('all')
    const [view, setView] = useState<'list' | 'grid'>(() => {
        const saved = localStorage.getItem('auctionsViewMode')
        return saved === 'list' ? 'list' : 'grid'
    })

    // DATA
    const [auctions, setAuctions] = useState<Auction[]>([])
    const [regularAuctions, setRegularAuctions] = useState<Auction[]>([])
    const [regularPage, setRegularPage] = useState(1)
    const [regularHasNextPage, setRegularHasNextPage] = useState(false)
    const [regularPageCursors, setRegularPageCursors] = useState<Array<QueryDocumentSnapshot<DocumentData> | null>>([null])
    const [ownerNamesById, setOwnerNamesById] = useState<Record<string, string>>({})
    const [activeAuction, setActiveAuction] = useState<Auction | null>(null)
    const [bids, setBids] = useState<AuctionBid[]>([])
    const [promotedLoading, setPromotedLoading] = useState(true)
    const [regularLoading, setRegularLoading] = useState(true)

    // i18n
    const lang = (localStorage.getItem('lang') as Lang) || DEFAULT_LANG
    const t = translations[lang]
    useEffect(() => {
        localStorage.setItem('auctionsViewMode', view)
    }, [view])

    const cityOptions = useMemo(
        () => Array.from(new Set(Object.values(CITIES_BY_VOIVODESHIP).flat())).sort((a, b) => a.localeCompare(b)),
        []
    )
    const currentRegularCursor = regularPageCursors[regularPage - 1] ?? null

    // =========================
    // LOAD PROMOTED AUCTIONS
    // =========================
    useEffect(() => {
        let cancelled = false

        async function loadPromotedAuctions() {
            try {
                setPromotedLoading(true)
                const loadPromotionType = async (promotionType: Auction['promotionType']) => {
                    const constraints: QueryConstraint[] = [
                        where('status', '==', 'active'),
                        where('promotionType', '==', promotionType),
                        where('endsAt', '>', now),
                        orderBy('endsAt', 'asc'),
                        limit(PROMOTED_AUCTIONS_LIMIT),
                    ]

                    if (city !== 'all') {
                        constraints.splice(2, 0, where('city', '==', city))
                    }

                    const snap = await getDocs(query(collection(db, 'auctions'), ...constraints))
                    return snap.docs.map(auctionFromDoc)
                }

                const [topAuctions, featuredAuctions] = await Promise.all([
                    loadPromotionType('top-auction'),
                    loadPromotionType('featured'),
                ])

                if (cancelled) return
                const data = [...topAuctions, ...featuredAuctions]
                setAuctions(data)
            } catch (error) {
                console.error('[auctions] failed to load promoted auctions', error)
            } finally {
                if (!cancelled) setPromotedLoading(false)
            }
        }

        loadPromotedAuctions()

        return () => {
            cancelled = true
        }
    }, [city, now])

    // =========================
    // LOAD REGULAR AUCTIONS PAGE
    // =========================
    useEffect(() => {
        let cancelled = false

        async function loadRegularAuctions() {
            try {
                setRegularLoading(true)
                const constraints: QueryConstraint[] = [
                    where('status', '==', 'active'),
                    where('endsAt', '>', now),
                    orderBy('endsAt', 'asc'),
                ]

                if (city !== 'all') {
                    constraints.splice(2, 0, where('city', '==', city))
                }

                if (currentRegularCursor) {
                    constraints.push(startAfter(currentRegularCursor))
                }

                constraints.push(limit(AUCTIONS_PAGE_SIZE + 1))

                const snap = await getDocs(query(collection(db, 'auctions'), ...constraints))
                if (cancelled) return

                const pageDocs = snap.docs.slice(0, AUCTIONS_PAGE_SIZE)
                const hasNext = snap.docs.length > AUCTIONS_PAGE_SIZE
                setRegularAuctions(pageDocs.map(auctionFromDoc))
                setRegularHasNextPage(hasNext)

                const nextCursor = pageDocs[pageDocs.length - 1] ?? null
                if (hasNext && nextCursor) {
                    setRegularPageCursors(prev => {
                        const next = prev.slice(0, regularPage)
                        next[regularPage] = nextCursor
                        return next
                    })
                }
            } catch (error) {
                console.error('[auctions] failed to load regular auctions', error)
                if (!cancelled) {
                    setRegularAuctions([])
                    setRegularHasNextPage(false)
                }
            } finally {
                if (!cancelled) setRegularLoading(false)
            }
        }

        loadRegularAuctions()

        return () => {
            cancelled = true
        }
    }, [city, currentRegularCursor, now, regularPage])

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
            ownerName: raw.ownerName ?? '',
            ownerNickname: raw.ownerNickname ?? null,
            bidsCount: raw.bidsCount ?? 0,
            status: raw.status ?? 'active',
            createdAt: raw.createdAt,
            endsAt: raw.endsAt,
            winnerId: raw.winnerId ?? null,
            winnerChatId: raw.winnerChatId ?? null,
            winnerChatNotifiedAt: raw.winnerChatNotifiedAt ?? null,
            winnerChatNotificationStatus: raw.winnerChatNotificationStatus ?? null,
            currentBidderId: raw.currentBidderId ?? null,
            currentBidderName: raw.currentBidderName ?? null,

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
            await finalizeAuction(auctionId).catch(error => {
                console.warn('[auction] finalize skipped', error)
            })
            await loadAuctionById(auctionId)
            await loadBids(auctionId)
        }

        openAuction()
    }, [slugOrId])

    useEffect(() => {
        const missingOwnerIds = [...auctions, ...regularAuctions]
            .filter(auction => !auction.ownerNickname && !auction.ownerName)
            .map(auction => auction.ownerId)
            .filter((id): id is string => !!id && !ownerNamesById[id])

        if (activeAuction && !activeAuction.ownerNickname && !activeAuction.ownerName && !ownerNamesById[activeAuction.ownerId]) {
            missingOwnerIds.push(activeAuction.ownerId)
        }

        if (missingOwnerIds.length === 0) return

        getUserPublicNicknames(missingOwnerIds, t.common.user)
            .then(names => setOwnerNamesById(prev => ({ ...prev, ...names })))
            .catch(error => console.warn('[auctions] failed to load owner nicknames', error))
    }, [activeAuction, auctions, ownerNamesById, regularAuctions, t.common.user])

    function getAuctionOwnerName(auction: Auction): string {
        return auction.ownerNickname?.trim()
            || auction.ownerName?.trim()
            || ownerNamesById[auction.ownerId]
            || t.common.user
    }

    const user = getLocalUser()
    const isAuthenticated = !!user
    const isRestrictedActiveAuction = ['hidden', 'deleted', 'removed', 'expired'].includes(activeAuction?.status ?? '')
    const canViewRestrictedAuction = !!activeAuction && (
        String(user?.id ?? '') === String(activeAuction.ownerId) ||
        isAdmin()
    )
    const visibleActiveAuction = activeAuction && (!isRestrictedActiveAuction || canViewRestrictedAuction)
        ? activeAuction
        : null
    const shouldShowStatusNotice = !!visibleActiveAuction &&
        ['hidden', 'deleted', 'removed', 'expired', 'ended'].includes(visibleActiveAuction.status ?? '')

    function getAuctionStatusMessage(status?: string) {
        if (status === 'hidden') return t.auctionDetails.statusMessages.hidden
        if (status === 'deleted') return t.auctionDetails.statusMessages.deleted
        if (status === 'removed') return t.auctionDetails.statusMessages.removed
        if (status === 'expired') return t.auctionDetails.statusMessages.expired
        if (status === 'ended') return t.auctionDetails.statusMessages.ended
        return t.auctions.notFound
    }

    const winnerContactId = visibleActiveAuction?.winnerId ?? visibleActiveAuction?.currentBidderId ?? null
    const isAuctionEndedForContact = !!visibleActiveAuction && (
        ['ended', 'expired'].includes(visibleActiveAuction.status ?? '') ||
        visibleActiveAuction.endsAt <= now
    )
    const canOpenWinnerChat = isAuctionEndedForContact && !!winnerContactId && !!user && (
        String(user.id) === String(visibleActiveAuction.ownerId) ||
        String(user.id) === String(winnerContactId)
    )

    async function openWinnerChat() {
        if (!visibleActiveAuction || !winnerContactId) return
        const chatId = visibleActiveAuction.winnerChatId || await getOrCreateChat(
            visibleActiveAuction.ownerId,
            winnerContactId
        )
        navigate(`/chat/${chatId}`)
    }

    useEffect(() => {
        if (!slugOrId || !visibleActiveAuction) return
        const canonicalPath = buildAuctionPath(visibleActiveAuction.title, visibleActiveAuction.city, visibleActiveAuction.id)
        if (`/auction/${slugOrId}` !== canonicalPath) {
            navigate(canonicalPath, { replace: true })
        }
    }, [slugOrId, visibleActiveAuction, navigate])
    const seoLang = (localStorage.getItem('lang') === 'pl' ? 'pl' : 'uk') as 'pl' | 'uk'
    const publicAuction = activeAuction?.status === 'active' && activeAuction.endsAt > now
        ? activeAuction
        : null
    const auctionCanonicalPath = activeAuction
        ? buildAuctionPath(activeAuction.title, activeAuction.city, activeAuction.id)
        : location.pathname
    const auctionSeoDescription = publicAuction
        ? buildSeoDescription(
            publicAuction.description,
            [
                `${seoLang === 'pl' ? 'Aktualna cena' : 'Поточна ціна'}: ${formatPricePLN(publicAuction.currentBid)}`,
                `${seoLang === 'pl' ? 'Cena wywoławcza' : 'Стартова ціна'}: ${formatPricePLN(publicAuction.startPrice)}`,
                publicAuction.city ? `${seoLang === 'pl' ? 'Lokalizacja' : 'Місто'}: ${publicAuction.city}` : undefined,
            ],
            seoLang === 'pl' ? 'Aukcja na Xoven.' : 'Аукціон на Xoven.',
        )
        : (seoLang === 'pl' ? 'Aukcje lokalne.' : 'Локальні аукціони.')

    useSeo({
        title: publicAuction
            ? `${publicAuction.title} — ${seoLang === 'pl' ? 'aukcja' : 'аукціон'}${publicAuction.city ? `, ${publicAuction.city}` : ''} | Xoven`
            : (seoLang === 'pl' ? 'Aukcje | Xoven' : 'Аукціони | Xoven'),
        description: auctionSeoDescription,
        path: auctionCanonicalPath,
        lang: seoLang,
        image: publicAuction?.images?.[0],
        ogType: slugOrId ? 'product' : 'website',
        noindex: !!slugOrId && !publicAuction,
        alternates: slugOrId ? [] : [
            { hreflang: 'pl-PL', href: `${BASE_URL}/pl/aukcje` },
            { hreflang: 'uk-UA', href: `${BASE_URL}/uk/auktsiony` },
            { hreflang: 'x-default', href: `${BASE_URL}/pl/aukcje` },
        ],
        jsonLd: publicAuction ? {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: publicAuction.title,
            description: publicAuction.description,
            image: publicAuction.images?.[0],
            offers: {
                '@type': 'Offer',
                priceCurrency: 'PLN',
                price: publicAuction.currentBid,
                availability: 'https://schema.org/InStock',
                url: `${BASE_URL}${buildAuctionPath(publicAuction.title, publicAuction.city, publicAuction.id)}`,
            },
        } : undefined,
    })

    // =========================
    // FILTERED LIST
    // =========================
    const {
        topAuctionsVisible,
        featuredAuctionsVisible,
    } = useMemo(() => {
        const rotationBucket = Math.floor(now / PROMOTION_ROTATION_INTERVAL_MS)

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
                ? rotatePromotedAuctions(topAuctionsAll, rotationBucket).slice(0, 3)
                : topAuctionsAll.slice(0, 3)

        const featuredAuctionsVisible =
            city === "all"
                ? rotatePromotedAuctions(featuredAuctionsAll, rotationBucket).slice(0, 6)
                : featuredAuctionsAll.slice(0, 6)

        // 6️⃣ ID показанных аукционов

        // 7️⃣ обычные — НИЧЕГО НЕ ПРОПАДАЕТ

        return {
            topAuctionsVisible,
            featuredAuctionsVisible,
        }
    }, [auctions, city, now])

    const visibleAuctionIds = useMemo(() => {
        return new Set([
            ...topAuctionsVisible.map(a => a.id),
            ...featuredAuctionsVisible.map(a => a.id),
        ])
    }, [topAuctionsVisible, featuredAuctionsVisible])

    const regularAuctionsVisible = useMemo(
        () => regularAuctions.filter(auction => !visibleAuctionIds.has(auction.id)),
        [regularAuctions, visibleAuctionIds]
    )

    function resetRegularPagination() {
        setRegularPage(1)
        setRegularPageCursors([null])
        setRegularHasNextPage(false)
    }

    function goToRegularPage(nextPage: number) {
        setRegularPage(Math.max(1, nextPage))
    }


    if (!slugOrId && promotedLoading && regularLoading && auctions.length === 0 && regularAuctions.length === 0) {
        return <div className="card">{t.auctions.loading}</div>
    }

    if (slugOrId && activeAuction && isRestrictedActiveAuction && !canViewRestrictedAuction) {
        return (
            <div className="card stack8">
                <strong>{getAuctionStatusMessage(activeAuction.status)}</strong>
                {activeAuction.moderationReason && (
                    <div>
                        <b>{t.auctionDetails.statusMessages.reason}:</b> {activeAuction.moderationReason}
                    </div>
                )}
            </div>
        )
    }




    // =========================
    // RENDER
    // =========================
    return (
        <div>
            <h2>{t.auctionTitle}</h2>

            {visibleActiveAuction ? (
                <>
                    {shouldShowStatusNotice && (
                        <div className="card stack8" style={{ border: '1px solid #fde68a', background: '#fffbeb', color: '#78350f', marginBottom: 12 }}>
                            <strong>{getAuctionStatusMessage(visibleActiveAuction.status)}</strong>
                            {visibleActiveAuction.moderationReason && (
                                <div>
                                    <b>{t.auctionDetails.statusMessages.reason}:</b> {visibleActiveAuction.moderationReason}
                                </div>
                            )}
                        </div>
                    )}
                    {canOpenWinnerChat && (
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={openWinnerChat}
                            style={{ marginBottom: 12 }}
                        >
                            {t.auctionDetails.openChat}
                        </button>
                    )}
                    <AuctionDetails
                        t={t}
                        auctionId={visibleActiveAuction.id}
                        title={visibleActiveAuction.title}
                        city={visibleActiveAuction.city}
                        description={visibleActiveAuction.description}
                        images={visibleActiveAuction.images}
                        currentBid={visibleActiveAuction.currentBid}
                        promotionType={visibleActiveAuction.promotionType}
                        promotionUntil={visibleActiveAuction.promotionUntil ?? null}
                        promotionQueueAt={visibleActiveAuction.promotionQueueAt ?? null}
                        timeLeft={getTimeLeft(visibleActiveAuction.endsAt)}
                        bids={bids}
                        isAuthenticated={isAuthenticated}
                        onBack={() => navigate('/auctions')}
                        seller={{
                            id: visibleActiveAuction.ownerId,
                            name: getAuctionOwnerName(visibleActiveAuction),
                            karma: 0,
                        }}
                        currentUserId={user?.id ?? null}
                        currentUserName={user?.nickname ?? user?.email ?? null}
                        onBidSuccess={() => {
                            loadAuctionById(visibleActiveAuction.id)
                            loadBids(visibleActiveAuction.id)
                        }}
                        onPromotionSuccess={() => {
                            loadAuctionById(visibleActiveAuction.id)
                        }}
                    />
                </>

            ) : (
                <>
                    <div style={{marginBottom: 12}}>
                        <select
                            value={city}
                            onChange={e => {
                                setCity(e.target.value)
                                resetRegularPagination()
                            }}
                            className="input"
                        >
                            <option value="all">{t.auctions.allCities}</option>

                            {cityOptions.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>

                        {/* Cursor pagination is ordered by endsAt; bid sorting can be added later as a separate query. */}
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
                                 style={{ cursor: 'pointer' }}
                                 onClick={() => navigate(buildAuctionPath(item.title, item.city, item.id))}>
                                <AuctionCard
                                    t={t}
                                    title={item.title}
                                    city={item.city}
                                    currentBid={item.currentBid}
                                    timeLeft={getTimeLeft(item.endsAt)}
                                    image={item.images[0]}
                                    ownerName={getAuctionOwnerName(item)}
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
                                 style={{ cursor: 'pointer' }}
                                 onClick={() => navigate(buildAuctionPath(item.title, item.city, item.id))}>
                                <AuctionCard
                                    t={t}
                                    title={item.title}
                                    city={item.city}
                                    currentBid={item.currentBid}
                                    timeLeft={getTimeLeft(item.endsAt)}
                                    image={item.images[0]}
                                    ownerName={getAuctionOwnerName(item)}
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


                        {regularAuctionsVisible.length > 0 && (
                            <div className="ads-separator">📄 {t.auctions.regular}</div>
                        )}
                        {regularAuctionsVisible.map(item => (
                            <div
                                key={item.id}
                                style={{ cursor: 'pointer' }}
                                onClick={() => navigate(buildAuctionPath(item.title, item.city, item.id))}
                            >
                                <AuctionCard
                                    t={t}
                                    title={item.title}
                                    city={item.city}
                                    currentBid={item.currentBid}
                                    timeLeft={getTimeLeft(item.endsAt)}
                                    image={item.images[0]}
                                    ownerName={getAuctionOwnerName(item)}
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

                    {(regularPage > 1 || regularHasNextPage) && (
                        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '20px 0' }}>
                            <button
                                className="btn-secondary"
                                disabled={regularPage <= 1 || regularLoading}
                                onClick={() => goToRegularPage(regularPage - 1)}
                            >
                                {t.home.prev}
                            </button>

                            <div style={{ alignSelf: 'center', fontSize: 14 }}>
                                {t.home.page} {regularPage}
                            </div>

                            <button
                                className="btn-secondary"
                                disabled={!regularHasNextPage || regularLoading}
                                onClick={() => goToRegularPage(regularPage + 1)}
                            >
                                {t.home.next}
                            </button>
                        </div>
                    )}

                </>
            )}
        </div>
    )
}

export default AuctionPage
