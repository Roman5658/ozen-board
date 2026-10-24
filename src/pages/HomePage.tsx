import type { Ad } from '../types/ad'
import { isExternalCatalogListing, type CatalogListing, type ExternalCatalogListing } from '../types/externalListing'

import AdCard from '../components/AdCard'
import CategoryFilter from '../components/CategoryFilter'
import FilterDisclosure from '../components/FilterDisclosure'
import VoivodeshipFilter from '../components/VoivodeshipFilter'
import CityByVoivodeshipFilter from '../components/CityByVoivodeshipFilter'
import { Link, useLocation } from 'react-router-dom'
import { getLocalUser } from '../data/localUser'

import { useEffect, useState, useMemo, useRef } from 'react'
import { collection, getDocs, query as firestoreQuery, where } from 'firebase/firestore'
import { db } from '../app/firebase'
import { buildAdPath } from '../utils/slug'
import { useSeo, BASE_URL } from '../utils/seo'
import { getUserPublicNicknames } from '../data/usersPublic'
import { getAdSellerDisplayName } from '../utils/adSellerDisplayName'
import { loadActiveExternalCatalogPage, type ExternalCatalogCursor } from '../data/externalListings'
import { loadExternalListingsConfig } from '../api/externalListings'
import {
    CATALOG_CATEGORIES,
    getCatalogSubcategoryIds,
    isCatalogCategoryId,
    isCatalogSubcategoryId,
    type CatalogCategoryFilter,
    type CatalogCategoryId,
    type CatalogSubcategoryId,
} from '../data/catalogCategories'
import {
    filterAndSortAds,
    parsePriceBound,
    type CatalogSortOrder,
    type OfferTypeFilter,
} from '../utils/catalogFilters'

type Voivodeship =
    | 'all'
    | 'dolnoslaskie'
    | 'kujawskoPomorskie'
    | 'lubelskie'
    | 'lubuskie'
    | 'lodzkie'
    | 'malopolskie'
    | 'mazowieckie'
    | 'opolskie'
    | 'podkarpackie'
    | 'podlaskie'
    | 'pomorskie'
    | 'slaskie'
    | 'swietokrzyskie'
    | 'warminskoMazurskie'
    | 'wielkopolskie'
    | 'zachodniopomorskie'

type Props = {
    t: {
        homeTitle: string
        home: {
            searchPlaceholder: string
            filtersTitle: string
            resetFilters: string
            priceFromSummary: string
            priceToSummary: string
            offerTypeLabel: string
            offerTypes: Record<OfferTypeFilter, string>
            catalogCategoryLabel: string
            allCatalogCategories: string
            unclassifiedCategory: string
            subcategoryLabel: string
            allSubcategories: string
            minPrice: string
            maxPrice: string
            invalidPriceRange: string
            minPriceExceedsMax: string
            sortLabel: string
            sortOptions: Record<CatalogSortOrder, string>
            emptyResults: string
            resultCount: string
            externalCatalogLimitNotice: string
            externalListings: string
            externalListingsLoading: string
            viewList: string
            viewGrid: string
            allCities: string
            top3: string
            top6: string
            bumped: string
            regular: string

            page: string
            of: string
            prev: string
            next: string
        }
        categories: {
            all: string
            work: string
            buy: string
            sell: string
            service: string
            rent: string
        }
        catalogCategories: Record<CatalogCategoryId, string>
        catalogSubcategories: Record<CatalogSubcategoryId, string>
        voivodeships: Record<Voivodeship, string>
        seo: {
            title: string
            description: string
            heroLine1: string
            heroLine2: string
            showSeoText: string
            hideSeoText: string
        }
        adCard: {
            today: string
            yesterday: string
            noPhoto: string
            user: string
            free: string
            exchange: string

            top3: string
            top6: string
            inQueue: string
            gold: string
            mine: string

            delete: string
            externalListing?: string
            externalOriginalLink?: string
        }

    }
}

const ONE_HOUR = 60 * 60 * 1000


// временная поддержка старого isPinned
function normalizeAd(ad: Ad): Ad {
    if (ad.isPinned && !ad.pinType) {
        return {
            ...ad,
            pinType: 'top3',
            pinnedAt: ad.pinnedAt ?? ad.createdAt,
        }
    }
    return ad
}

function isActivePin(ad: CatalogListing, now: number) {
    return (
        ad.status === 'active' &&
        !!ad.pinType &&
        typeof ad.pinnedUntil === 'number' &&
        ad.pinnedUntil > now
    )
}

function stableHash(value: string): number {
    let hash = 2166136261

    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i)
        hash = Math.imul(hash, 16777619)
    }

    return hash >>> 0
}

function prioritizeCityDiversity<T extends { id: string; city?: string }>(ads: T[]): T[] {
    const selected: T[] = []
    const selectedIds = new Set<string>()
    const seenCities = new Set<string>()

    for (const ad of ads) {
        if (ad.city && seenCities.has(ad.city)) continue
        if (ad.city) seenCities.add(ad.city)
        selected.push(ad)
        selectedIds.add(ad.id)
    }

    for (const ad of ads) {
        if (selectedIds.has(ad.id)) continue
        selected.push(ad)
    }

    return selected
}

function sortTopAds(ads: CatalogListing[]): CatalogListing[] {
    return [...ads].sort((a, b) => {
        const timeDiff = (a.pinnedAt ?? a.createdAt) - (b.pinnedAt ?? b.createdAt)
        if (timeDiff !== 0) return timeDiff
        return a.id.localeCompare(b.id)
    })
}

function sortTopAdsForRotation(ads: CatalogListing[], rotationBucket: number): CatalogListing[] {
    return [...ads].sort((a, b) => {
        const scoreDiff =
            stableHash(`${a.city}:${a.id}:${rotationBucket}`) -
            stableHash(`${b.city}:${b.id}:${rotationBucket}`)

        if (scoreDiff !== 0) return scoreDiff

        const timeDiff = (a.pinnedAt ?? a.createdAt) - (b.pinnedAt ?? b.createdAt)
        if (timeDiff !== 0) return timeDiff

        return a.id.localeCompare(b.id)
    })
}

function pickTopAdsForDisplay(ads: CatalogListing[], city: string, limit: number, rotationBucket: number): CatalogListing[] {
    if (city) {
        return sortTopAds(ads.filter(ad => ad.city === city)).slice(0, limit)
    }

    return prioritizeCityDiversity(sortTopAdsForRotation(ads, rotationBucket)).slice(0, limit)
}

function HomePage({ t }: Props) {
    const location = useLocation()
    const lang = location.pathname.startsWith('/pl') ? 'pl' : 'uk'

    useSeo({
        title: t.seo.title,
        description: t.seo.description,
        path: location.pathname,
        lang,
        alternates: [
            { hreflang: 'pl-PL', href: `${BASE_URL}/pl/` },
            { hreflang: 'uk-UA', href: `${BASE_URL}/uk/` },
            { hreflang: 'x-default', href: `${BASE_URL}/pl/` },
        ],
        jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Xoven', item: `${BASE_URL}/${lang}/` },
                { '@type': 'ListItem', position: 2, name: lang === 'pl' ? 'Ogłoszenia' : 'Оголошення', item: `${BASE_URL}${location.pathname}` },
            ],
        },
    })
    const [category, setCategory] = useState<
        'all' | 'work' | 'buy' | 'sell' | 'service' | 'rent'
    >('all')
    const [catalogCategory, setCatalogCategory] = useState<CatalogCategoryFilter>('all')
    const [catalogSubcategory, setCatalogSubcategory] = useState<CatalogSubcategoryId | ''>('')
    const [offerType, setOfferType] = useState<OfferTypeFilter>('all')
    const [minPrice, setMinPrice] = useState('')
    const [maxPrice, setMaxPrice] = useState('')
    const [sort, setSort] = useState<CatalogSortOrder>('newest')

    const [voivodeship, setVoivodeship] = useState<Voivodeship>('all')
    const [query, setQuery] = useState('')
    const [city, setCity] = useState('')
    const [fireAds, setFireAds] = useState<Ad[]>([])
    const [externalCatalogEnabled, setExternalCatalogEnabled] = useState<boolean | null>(null)
    const [telegramExternalListingsEnabled, setTelegramExternalListingsEnabled] = useState(false)
    const [externalPages, setExternalPages] = useState<ExternalCatalogListing[][]>([])
    const [externalPageCursors, setExternalPageCursors] = useState<(ExternalCatalogCursor | null)[]>([null])
    const [externalPageHasMore, setExternalPageHasMore] = useState<boolean[]>([])
    const [externalScanLimited, setExternalScanLimited] = useState(false)
    const [externalPage, setExternalPage] = useState(1)
    const [externalLoading, setExternalLoading] = useState(true)
    const externalRequestGeneration = useRef(0)
    const [usersById, setUsersById] = useState<Record<string, string>>({})
    const [view, setView] = useState<'list' | 'grid'>(() => {
        const saved = localStorage.getItem('adsViewMode')
        return saved === 'list' ? 'list' : 'grid'
    })
    const PAGE_SIZE = 30
    const [page, setPage] = useState(1)
    const [isSeoTextVisible, setIsSeoTextVisible] = useState(false)
    const [now, setNow] = useState(() => Date.now())
    const adsListStartRef = useRef<HTMLDivElement | null>(null)
    const rotationBucket = useMemo(() => Math.floor(now / ONE_HOUR), [now])
    const localUser = getLocalUser()
    const currentUserId = localUser?.id


    useEffect(() => {
        async function loadAds() {
            try {
                const snap = await getDocs(firestoreQuery(
                    collection(db, 'ads'),
                    where('status', '==', 'active')
                ))
                const data: Ad[] = snap.docs.map(doc => ({
                    id: doc.id,
                    ...(doc.data() as Omit<Ad, 'id'>),
                }))
                setFireAds(data)
                setNow(Date.now())
            } catch (error) {
                console.error('[home] failed to load ads', error)
            }
        }

        loadAds()
    }, [])

    useEffect(() => {
        const missingUserIds = fireAds
            .filter(ad => !getAdSellerDisplayName(ad))
            .map(ad => ad.userId)
            .filter((id): id is string => !!id && !usersById[id])

        if (missingUserIds.length === 0) return

        getUserPublicNicknames(missingUserIds, t.adCard.user)
            .then(names => setUsersById(prev => ({ ...prev, ...names })))
            .catch(error => console.warn('[home] failed to load user nicknames', error))
    }, [fireAds, t.adCard.user, usersById])

    function getAdUserNickname(ad: CatalogListing): string | undefined {
        if (isExternalCatalogListing(ad)) return undefined
        return getAdSellerDisplayName(ad) || usersById[ad.userId]
    }
    useEffect(() => {
        localStorage.setItem('adsViewMode', view)
    }, [view])
    const minPriceResult = useMemo(() => parsePriceBound(minPrice), [minPrice])
    const maxPriceResult = useMemo(() => parsePriceBound(maxPrice), [maxPrice])
    const priceRangeError = minPriceResult.error || maxPriceResult.error
        ? t.home.invalidPriceRange
        : minPriceResult.value !== null && maxPriceResult.value !== null && minPriceResult.value > maxPriceResult.value
            ? t.home.minPriceExceedsMax
            : ''
    const activeFilterLabels = useMemo(() => {
        const labels: string[] = []
        if (query.trim()) labels.push(`${t.home.searchPlaceholder}: ${query.trim().slice(0, 28)}`)
        if (offerType !== 'all') labels.push(t.home.offerTypes[offerType])
        if (catalogCategory === 'uncategorized') labels.push(t.home.unclassifiedCategory)
        else if (isCatalogCategoryId(catalogCategory)) labels.push(t.catalogCategories[catalogCategory])
        if (catalogSubcategory) labels.push(t.catalogSubcategories[catalogSubcategory])
        if (minPrice || maxPrice) {
            const from = minPrice ? t.home.priceFromSummary.replace('{{value}}', minPrice) : ''
            const to = maxPrice ? t.home.priceToSummary.replace('{{value}}', maxPrice) : ''
            labels.push([from, to].filter(Boolean).join(' — '))
        }
        if (sort !== 'newest') labels.push(t.home.sortOptions[sort])
        if (city) labels.push(city)
        else if (voivodeship !== 'all') labels.push(t.voivodeships[voivodeship])
        return labels
    }, [query, offerType, catalogCategory, catalogSubcategory, minPrice, maxPrice, sort, city, voivodeship, t])

    function resetAdditionalFilters() {
        setQuery('')
        setOfferType('all')
        setCatalogCategory('all')
        setCatalogSubcategory('')
        setMinPrice('')
        setMaxPrice('')
        setSort('newest')
        setVoivodeship('all')
        setCity('')
        setPage(1)
    }

    const filteredAndSortedAds = useMemo(() => filterAndSortAds(
        fireAds.map(normalizeAd),
        {
            category,
            catalogCategory,
            catalogSubcategory,
            offerType,
            voivodeship,
            city,
            query,
            minPrice,
            maxPrice,
            sort,
        },
    ), [fireAds, category, catalogCategory, catalogSubcategory, offerType, voivodeship, city, query, minPrice, maxPrice, sort])

    const externalFilters = useMemo(() => ({
        category,
        catalogCategory,
        catalogSubcategory,
        offerType,
        voivodeship,
        city,
        query,
        minPrice,
        maxPrice,
        sort,
    }), [category, catalogCategory, catalogSubcategory, offerType, voivodeship, city, query, minPrice, maxPrice, sort])

    useEffect(() => {
        let cancelled = false
        loadExternalListingsConfig().then((config) => {
            if (!cancelled) {
                setExternalCatalogEnabled(config.enabled)
                setTelegramExternalListingsEnabled(config.telegramEnabled)
            }
        })
        return () => { cancelled = true }
    }, [])

    useEffect(() => {
        const generation = ++externalRequestGeneration.current
        let cancelled = false
        setExternalPages([])
        setExternalPageCursors([null])
        setExternalPageHasMore([])
        setExternalScanLimited(false)
        setExternalPage(1)
        if (externalCatalogEnabled !== true) {
            setExternalLoading(externalCatalogEnabled === null)
            return () => { cancelled = true }
        }
        setExternalLoading(true)
        loadActiveExternalCatalogPage(db, externalFilters, null, undefined, telegramExternalListingsEnabled)
            .then((result) => {
                if (cancelled || generation !== externalRequestGeneration.current) return
                setExternalPages([result.listings])
                setExternalPageCursors([null, result.cursor])
                setExternalPageHasMore([result.hasMore])
                setExternalScanLimited(result.scanLimited)
            })
            .catch((error) => {
                console.warn('[home] external catalog page is unavailable', error)
                if (!cancelled && generation === externalRequestGeneration.current) {
                    setExternalPages([[]])
                    setExternalPageCursors([null, null])
                    setExternalPageHasMore([false])
                }
            })
            .finally(() => {
                if (!cancelled && generation === externalRequestGeneration.current) setExternalLoading(false)
            })
        return () => { cancelled = true }
    }, [externalFilters, externalCatalogEnabled, telegramExternalListingsEnabled])

    const currentExternalAds = externalPages[externalPage - 1] ?? []
    const currentExternalHasMore = externalPageHasMore[externalPage - 1] ?? false

    const activePinnedAds = useMemo(
        () => filteredAndSortedAds.filter(ad => isActivePin(ad, now)),
        [filteredAndSortedAds, now]
    )

    const allTop3 = useMemo(
        () => sortTopAds(activePinnedAds.filter(ad => !isExternalCatalogListing(ad) && ad.pinType === "top3")),
        [activePinnedAds]
    )
    const allTop6 = useMemo(
        () => sortTopAds(activePinnedAds.filter(ad => !isExternalCatalogListing(ad) && ad.pinType === "top6")),
        [activePinnedAds]
    )


    const top3Ads = useMemo(
        () => pickTopAdsForDisplay(allTop3, city, 3, rotationBucket),
        [allTop3, city, rotationBucket]
    )

    const top6Ads = useMemo(
        () => pickTopAdsForDisplay(allTop6, city, 6, rotationBucket),
        [allTop6, city, rotationBucket]
    )
    const bumpAds = useMemo(
        () => filteredAndSortedAds.filter(ad =>
            ad.status === "active" && !isActivePin(ad, now) && ad.bumpAt
        ),
        [filteredAndSortedAds, now]
    )

    const regularAds = useMemo(() => filteredAndSortedAds.filter(ad => {
        if (ad.status !== 'active') return false
        if (ad.bumpAt) return false

        const activePin = isActivePin(ad, now)

        // активные TOP показываются только в TOP-блоках, а не в обычной ленте
        if (activePin) {
            return false
        }

        // сюда попадают:
        // • обычные
        // • в очереди
        return true
    }), [filteredAndSortedAds, now])



    const totalPages = useMemo(
        () => Math.ceil(regularAds.length / PAGE_SIZE),
        [regularAds.length]
    )

    const pagedRegularAds = useMemo(
        () => regularAds.slice(
            (page - 1) * PAGE_SIZE,
            page * PAGE_SIZE
        ),
        [page, regularAds]
    )

    function scrollToPageTop() {
        const scroll = () => {
            adsListStartRef.current?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
            })
        }

        window.requestAnimationFrame(() => {
            scroll()
            window.setTimeout(scroll, 0)
        })
    }

    function goToPage(nextPage: number) {
        const safePage = Math.min(Math.max(nextPage, 1), totalPages || 1)
        const shouldScrollToListStart = safePage > page
        setPage(safePage)
        if (shouldScrollToListStart) {
            scrollToPageTop()
        }
    }

    async function goToExternalPage(nextPage: number) {
        if (!externalCatalogEnabled || externalLoading || nextPage < 1) return
        if (nextPage <= externalPages.length) {
            setExternalPage(nextPage)
            return
        }
        if (nextPage !== externalPages.length + 1 || !currentExternalHasMore) return

        const cursor = externalPageCursors[externalPages.length] ?? null
        if (!cursor) return
        const generation = externalRequestGeneration.current
        setExternalLoading(true)
        try {
            const result = await loadActiveExternalCatalogPage(db, externalFilters, cursor, undefined, telegramExternalListingsEnabled)
            if (generation !== externalRequestGeneration.current) return
            setExternalPages((previous) => [...previous, result.listings])
            setExternalPageCursors((previous) => [...previous, result.cursor])
            setExternalPageHasMore((previous) => [...previous, result.hasMore])
            setExternalScanLimited(result.scanLimited)
            setExternalPage(nextPage)
        } catch (error) {
            console.warn('[home] failed to load next external catalog page', error)
        } finally {
            if (generation === externalRequestGeneration.current) setExternalLoading(false)
        }
    }

    function renderCatalogCard(ad: CatalogListing) {
        if (isExternalCatalogListing(ad)) {
            return (
                <div key={ad.id}>
                    <AdCard
                        title={ad.title}
                        price={ad.price}
                        priceType={ad.priceType}
                        city={ad.city}
                        description={ad.description}
                        images={ad.images}
                        createdAt={ad.createdAt}
                        externalSourceName={ad.sourceName || ad.sourceId}
                        externalOriginalUrl={ad.originalUrl}
                        labels={t.adCard}
                    />
                </div>
            )
        }

        return (
            <div className="telegram-card-wrapper" key={ad.id}>
                <Link to={buildAdPath(ad.title, ad.city, ad.id)} style={{ textDecoration: 'none' }}>
                    <AdCard
                        ad={ad}
                        isMine={ad.userId === currentUserId}
                        userNickname={getAdUserNickname(ad)}
                        labels={t.adCard}
                    />
                </Link>
                {ad.sourceType === 'telegram' && ad.sourceUrl && (
                    <a className="telegram-card-wrapper__source" href={ad.sourceUrl} target="_blank" rel="noopener noreferrer">
                        {window.location.pathname.startsWith('/pl') ? 'Oryginalny post na Telegramie' : 'Оригінальний допис у Telegram'}
                    </a>
                )}
            </div>
        )
    }

    return (
        <div>
            <h2 className="h2">{t.homeTitle}</h2>

            <div className="card" style={{marginBottom: 14}}>
                <button
                    className="btn-secondary"
                    type="button"
                    onClick={() => setIsSeoTextVisible(v => !v)}
                >
                    {isSeoTextVisible ? t.seo.hideSeoText : t.seo.showSeoText}
                </button>

                {isSeoTextVisible && (
                    <div style={{ marginTop: 10, fontSize: '14px', lineHeight: 1.5 }}>
                        {t.seo.heroLine1}

                        <br /><br />

                        {t.seo.heroLine2}
                    </div>
                )}
            </div>

            <div className="card home-catalog-controls">
                <CategoryFilter
                    value={category}
                    onChange={value => {
                        setCategory(value)
                        setPage(1)
                    }}
                    t={t}
                />
                <div className="home-catalog-controls__toolbar">
                    <div className="home-view-toggle">
                        <button type="button" className={view === 'list' ? 'btn-primary' : 'btn-secondary'} onClick={() => setView('list')}>
                            {t.home.viewList}
                        </button>
                        <button type="button" className={view === 'grid' ? 'btn-primary' : 'btn-secondary'} onClick={() => setView('grid')}>
                            {t.home.viewGrid}
                        </button>
                    </div>
                    <FilterDisclosure
                        title={t.home.filtersTitle}
                        resetLabel={t.home.resetFilters}
                        activeLabels={activeFilterLabels}
                        onReset={resetAdditionalFilters}
                    >
                        <div className="home-filters__grid">
                            <label className="stack4">
                                <span>{t.home.searchPlaceholder}</span>
                                <input className="input" value={query} onChange={(event) => {
                                    setQuery(event.target.value)
                                    setPage(1)
                                }} />
                            </label>
                            <VoivodeshipFilter
                                value={voivodeship}
                                onChange={(value) => {
                                    setVoivodeship(value)
                                    setCity('')
                                    setPage(1)
                                }}
                                t={t}
                            />
                            <CityByVoivodeshipFilter
                                voivodeship={voivodeship}
                                value={city}
                                onChange={(value) => {
                                    setCity(value)
                                    setPage(1)
                                }}
                                t={{allCities: t.home.allCities}}
                            />
                    <label className="stack4">
                        <span>{t.home.offerTypeLabel}</span>
                        <select className="input" value={offerType} onChange={(event) => {
                            setOfferType(event.target.value as OfferTypeFilter)
                            setPage(1)
                        }}>
                            {(['all', 'paid', 'free', 'exchange'] as const).map((value) => (
                                <option key={value} value={value}>{t.home.offerTypes[value]}</option>
                            ))}
                        </select>
                    </label>

                    <label className="stack4">
                        <span>{t.home.catalogCategoryLabel}</span>
                        <select className="input" value={catalogCategory} onChange={(event) => {
                            const value = event.target.value
                            setCatalogCategory(value === 'uncategorized' || isCatalogCategoryId(value) ? value : 'all')
                            setCatalogSubcategory('')
                            setPage(1)
                        }}>
                            <option value="all">{t.home.allCatalogCategories}</option>
                            <option value="uncategorized">{t.home.unclassifiedCategory}</option>
                            {Object.keys(CATALOG_CATEGORIES).map((key) => (
                                <option key={key} value={key}>{t.catalogCategories[key as CatalogCategoryId]}</option>
                            ))}
                        </select>
                    </label>

                    <label className="stack4">
                        <span>{t.home.subcategoryLabel}</span>
                        <select className="input" value={catalogSubcategory} disabled={!isCatalogCategoryId(catalogCategory)} onChange={(event) => {
                            const value = event.target.value
                            setCatalogSubcategory(isCatalogCategoryId(catalogCategory) && isCatalogSubcategoryId(catalogCategory, value) ? value : '')
                            setPage(1)
                        }}>
                            <option value="">{t.home.allSubcategories}</option>
                            {isCatalogCategoryId(catalogCategory) && getCatalogSubcategoryIds(catalogCategory).map((subcategory) => (
                                <option key={subcategory} value={subcategory}>{t.catalogSubcategories[subcategory]}</option>
                            ))}
                        </select>
                    </label>

                    <label className="stack4">
                        <span>{t.home.minPrice}</span>
                        <input className="input" type="text" inputMode="decimal" value={minPrice} aria-invalid={!!priceRangeError} onChange={(event) => {
                            setMinPrice(event.target.value)
                            setPage(1)
                        }} />
                    </label>

                    <label className="stack4">
                        <span>{t.home.maxPrice}</span>
                        <input className="input" type="text" inputMode="decimal" value={maxPrice} aria-invalid={!!priceRangeError} onChange={(event) => {
                            setMaxPrice(event.target.value)
                            setPage(1)
                        }} />
                    </label>

                    <label className="stack4">
                        <span>{t.home.sortLabel}</span>
                        <select className="input" value={sort} onChange={(event) => {
                            setSort(event.target.value as CatalogSortOrder)
                            setPage(1)
                        }}>
                            {(['newest', 'oldest', 'priceAsc', 'priceDesc'] as const).map((value) => (
                                <option key={value} value={value}>{t.home.sortOptions[value]}</option>
                            ))}
                        </select>
                    </label>
                </div>
                        {priceRangeError && <div className="home-filters__error" role="alert">{priceRangeError}</div>}
                        <div className="home-filters__count" aria-live="polite">
                            {t.home.resultCount}: {filteredAndSortedAds.length}
                        </div>
                    </FilterDisclosure>
                </div>
            </div>

            <div ref={adsListStartRef} />

            <div className={`ads-grid ${view === 'list' ? 'ads-grid--list' : 'ads-grid--grid'}`}>

                {top3Ads.length > 0 && (
                    <div className="ads-separator">{t.home.top3}</div>

                )}
                {top3Ads.map(renderCatalogCard)}

                {top6Ads.length > 0 && (
                    <div className="ads-separator">{t.home.top6}</div>

                )}
                {top6Ads.map(renderCatalogCard)}

                {bumpAds.length > 0 && (
                    <div className="ads-separator">{t.home.bumped}</div>

                )}
                {bumpAds.map(renderCatalogCard)}

                {regularAds.length > 0 && (
                    <div className="ads-separator">{t.home.regular}</div>

                )}
                {pagedRegularAds.map(renderCatalogCard)}

                {(externalLoading || currentExternalAds.length > 0 || externalPage > 1 || currentExternalHasMore) && (
                    <>
                        <div className="ads-separator">{t.home.externalListings} ({currentExternalAds.length})</div>
                        {currentExternalAds.map(renderCatalogCard)}
                        {externalScanLimited && (
                            <div className="home-filters__error" role="status">
                                {t.home.externalCatalogLimitNotice}
                            </div>
                        )}
                        {externalLoading && <div className="card">{t.home.externalListingsLoading}</div>}
                        {!externalLoading && currentExternalAds.length === 0 && currentExternalHasMore && (
                            <div className="card">{t.home.externalCatalogLimitNotice}</div>
                        )}
                        {(externalPage > 1 || currentExternalHasMore) && (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '12px 0 20px' }}>
                                <button
                                    className="btn-secondary"
                                    disabled={externalPage === 1 || externalLoading}
                                    onClick={() => void goToExternalPage(externalPage - 1)}
                                >
                                    {t.home.prev}
                                </button>
                                <div style={{ alignSelf: 'center', fontSize: 14 }}>
                                    {t.home.page} {externalPage}
                                </div>
                                <button
                                    className="btn-secondary"
                                    disabled={!currentExternalHasMore || externalLoading}
                                    onClick={() => void goToExternalPage(externalPage + 1)}
                                >
                                    {t.home.next}
                                </button>
                            </div>
                        )}
                    </>
                )}


            </div>
            {filteredAndSortedAds.length === 0 && currentExternalAds.length === 0 && !externalLoading && !currentExternalHasMore && (
                <div className="card home-empty-results">{t.home.emptyResults}</div>
            )}
            {totalPages > 1 && (
                <div style={{display: "flex", justifyContent: "center", gap: 8, margin: "20px 0"}}>
                    <button
                        className="btn-secondary"
                        disabled={page === 1}
                        onClick={() => goToPage(page - 1)}
                    >
                        {t.home.prev}

                    </button>

                    <div style={{alignSelf: "center", fontSize: 14}}>
                        {t.home.page} {page} {t.home.of} {totalPages}

                    </div>

                    <button
                        className="btn-secondary"
                        disabled={page === totalPages}
                        onClick={() => goToPage(page + 1)}
                    >
                        {t.home.next}

                    </button>

                </div>
            )}

        </div>
    )
}

export default HomePage
