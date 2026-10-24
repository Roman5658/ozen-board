import { useEffect, useMemo, useState } from 'react'
import AdCard from '../components/AdCard'
import FilterDisclosure from '../components/FilterDisclosure'
import type { Ad } from '../types/ad'
import { getAdsWithinRadius } from '../utils/nearbyFilters'
import { Link } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../app/firebase'
import { buildAdPath } from '../utils/slug'
import { getUserPublicNicknames } from '../data/usersPublic'
import { getAdSellerDisplayName } from '../utils/adSellerDisplayName'
import { CITIES_BY_VOIVODESHIP } from '../data/cities'
import { CATALOG_CATEGORIES, getCatalogSubcategoryIds, isCatalogCategoryId, isCatalogSubcategoryId, type CatalogCategoryId, type CatalogSubcategoryId } from '../data/catalogCategories'
import { filterAndSortAds, parseAdPriceAmount, parsePriceBound, type OfferTypeFilter } from '../utils/catalogFilters'
import type { translations } from '../app/i18n'

type Props = { t: (typeof translations)[keyof typeof translations] }
type GeoStatus = 'loading' | 'ready' | 'denied'
type NearbySort = 'distance' | 'newest' | 'oldest' | 'priceAsc' | 'priceDesc'
type NearbyAd = Ad & { distance?: number }
type ListingCategory = 'all' | 'work' | 'buy' | 'sell' | 'service' | 'rent'

function NearbyPage({ t }: Props) {
    const [radius, setRadius] = useState(10)
    const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null)
    const [geoStatus, setGeoStatus] = useState<GeoStatus>(() =>
        typeof navigator !== 'undefined' && navigator.geolocation ? 'loading' : 'denied',
    )
    const [selectedCity, setSelectedCity] = useState('')
    const [category, setCategory] = useState<ListingCategory>('all')
    const [offerType, setOfferType] = useState<OfferTypeFilter>('all')
    const [catalogCategory, setCatalogCategory] = useState<'all' | 'uncategorized' | CatalogCategoryId>('all')
    const [catalogSubcategory, setCatalogSubcategory] = useState<CatalogSubcategoryId | ''>('')
    const [minPrice, setMinPrice] = useState('')
    const [maxPrice, setMaxPrice] = useState('')
    const [sort, setSort] = useState<NearbySort>(() =>
        typeof navigator !== 'undefined' && navigator.geolocation ? 'distance' : 'newest',
    )
    const [search, setSearch] = useState('')
    const [ads, setAds] = useState<Ad[]>([])
    const [usersById, setUsersById] = useState<Record<string, string>>({})
    const [view, setView] = useState<'list' | 'grid'>(() => {
        const saved = localStorage.getItem('nearbyAdsViewMode')
        return saved === 'list' ? 'list' : 'grid'
    })

    useEffect(() => {
        localStorage.setItem('nearbyAdsViewMode', view)
    }, [view])

    // Ask once when this page mounts. Opening or closing the filter panel never repeats it.
    useEffect(() => {
        if (!navigator.geolocation) {
            return
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude })
                setGeoStatus('ready')
            },
            () => {
                setGeoStatus('denied')
                setSort('newest')
            },
            { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
        )
    }, [])

    useEffect(() => {
        let cancelled = false
        async function loadAds() {
            try {
                const snap = await getDocs(query(collection(db, 'ads'), where('status', '==', 'active')))
                if (cancelled) return
                const data: Ad[] = snap.docs.map((item) => ({
                    id: item.id,
                    ...(item.data() as Omit<Ad, 'id'>),
                }))
                setAds(data.filter((ad) => (ad.status ?? 'active') === 'active'))
            } catch (error) {
                console.error('[nearby] failed to load ads', error)
                if (!cancelled) setAds([])
            }
        }
        loadAds()
        return () => { cancelled = true }
    }, [])

    useEffect(() => {
        const missingUserIds = ads
            .filter((ad) => !getAdSellerDisplayName(ad))
            .map((ad) => ad.userId)
            .filter((id): id is string => !!id && !usersById[id])
        if (missingUserIds.length === 0) return
        getUserPublicNicknames(missingUserIds, t.adCard.user)
            .then((names) => setUsersById((previous) => ({ ...previous, ...names })))
            .catch((error) => console.warn('[nearby] failed to load user nicknames', error))
    }, [ads, t.adCard.user, usersById])

    const cityOptions = useMemo(
        () => Array.from(new Set([
            ...Object.values(CITIES_BY_VOIVODESHIP).flat(),
            ...ads.map((ad) => ad.city).filter(Boolean),
        ])).sort((a, b) => a.localeCompare(b)),
        [ads],
    )

    const minPriceResult = useMemo(() => parsePriceBound(minPrice), [minPrice])
    const maxPriceResult = useMemo(() => parsePriceBound(maxPrice), [maxPrice])
    const priceRangeError = minPriceResult.error || maxPriceResult.error
        ? t.home.invalidPriceRange
        : minPriceResult.value !== null && maxPriceResult.value !== null && minPriceResult.value > maxPriceResult.value
            ? t.home.minPriceExceedsMax
            : ''

    const nearbyAds = useMemo<NearbyAd[]>(() => {
        const candidates = filterAndSortAds(ads, {
            category,
            catalogCategory,
            catalogSubcategory,
            offerType,
            voivodeship: 'all',
            city: geoStatus === 'denied' ? selectedCity : '',
            query: search,
            minPrice,
            maxPrice,
            sort: 'newest',
        })

        let results: NearbyAd[]
        if (geoStatus === 'ready' && userPos) {
            results = getAdsWithinRadius(candidates, userPos, radius)
        } else if (selectedCity) {
            results = candidates.filter((ad) => ad.city === selectedCity)
        } else {
            results = []
        }

        return results.sort((left, right) => {
            if (sort === 'distance' && left.distance !== undefined && right.distance !== undefined) {
                return left.distance - right.distance || right.createdAt - left.createdAt || left.id.localeCompare(right.id)
            }
            if (sort === 'oldest') return left.createdAt - right.createdAt || left.id.localeCompare(right.id)
            if (sort === 'priceAsc' || sort === 'priceDesc') {
                const leftPrice = left.priceType === 'free' || left.priceType === 'exchange' ? null : parseAdPriceAmount(left.price)
                const rightPrice = right.priceType === 'free' || right.priceType === 'exchange' ? null : parseAdPriceAmount(right.price)
                if (leftPrice === null && rightPrice !== null) return 1
                if (leftPrice !== null && rightPrice === null) return -1
                if (leftPrice !== null && rightPrice !== null && leftPrice !== rightPrice) {
                    return (leftPrice - rightPrice) * (sort === 'priceAsc' ? 1 : -1)
                }
            }
            return right.createdAt - left.createdAt || left.id.localeCompare(right.id)
        })
    }, [ads, category, catalogCategory, catalogSubcategory, offerType, geoStatus, selectedCity, search, minPrice, maxPrice, userPos, radius, sort])

    const activeFilterLabels = useMemo(() => {
        const labels: string[] = []
        if (search.trim()) labels.push(`${t.home.searchPlaceholder}: ${search.trim().slice(0, 28)}`)
        if (category !== 'all') labels.push(t.categories[category])
        if (offerType !== 'all') labels.push(t.home.offerTypes[offerType])
        if (catalogCategory === 'uncategorized') labels.push(t.home.unclassifiedCategory)
        else if (isCatalogCategoryId(catalogCategory)) labels.push(t.catalogCategories[catalogCategory])
        if (catalogSubcategory) labels.push(t.catalogSubcategories[catalogSubcategory])
        if (minPrice || maxPrice) {
            labels.push([
                minPrice ? t.home.priceFromSummary.replace('{{value}}', minPrice) : '',
                maxPrice ? t.home.priceToSummary.replace('{{value}}', maxPrice) : '',
            ].filter(Boolean).join(' — '))
        }
        if (sort !== (geoStatus === 'ready' ? 'distance' : 'newest')) {
            labels.push(sort === 'distance' ? t.nearby.sortDistance : t.home.sortOptions[sort])
        }
        if (geoStatus === 'ready' && radius !== 10) labels.push(`${t.nearby.distanceLabel}: ${radius} ${t.nearby.radiusKm}`)
        if (geoStatus === 'denied' && selectedCity) labels.push(`${t.nearby.cityLabel}: ${selectedCity}`)
        return labels
    }, [search, category, offerType, catalogCategory, catalogSubcategory, minPrice, maxPrice, sort, geoStatus, radius, selectedCity, t])

    function resetFilters() {
        setCategory('all')
        setOfferType('all')
        setCatalogCategory('all')
        setCatalogSubcategory('')
        setMinPrice('')
        setMaxPrice('')
        setSearch('')
        setRadius(10)
        setSelectedCity('')
        setSort(geoStatus === 'ready' ? 'distance' : 'newest')
    }

    if (geoStatus === 'loading') return <div className="card">{t.nearby.detectingLocation}</div>

    const emptyMessage = geoStatus === 'ready'
        ? t.nearby.emptyNearby
        : selectedCity ? t.nearby.emptyCity : t.nearby.searchLocation

    return (
        <div className="nearby-page">
            <h2 className="h2">{t.nearbyTitle}</h2>
            {geoStatus === 'denied' && <p className="nearby-page__geo-note">{t.nearby.geoUnavailable}</p>}

            <div className="card nearby-controls">
                <div className="nearby-controls__toolbar">
                    <div className="nearby-view-toggle">
                        <button type="button" className={view === 'list' ? 'btn-primary' : 'btn-secondary'} onClick={() => setView('list')}>
                            {t.nearby.viewList}
                        </button>
                        <button type="button" className={view === 'grid' ? 'btn-primary' : 'btn-secondary'} onClick={() => setView('grid')}>
                            {t.nearby.viewGrid}
                        </button>
                    </div>
                    <FilterDisclosure
                        title={t.nearby.filtersTitle}
                        resetLabel={t.home.resetFilters}
                        activeLabels={activeFilterLabels}
                        onReset={resetFilters}
                    >
                        <div className="home-filters__grid">
                            {geoStatus === 'ready' ? (
                                <label className="stack4">
                                    <span>{t.nearby.distanceLabel}</span>
                                    <select className="input" value={radius} onChange={(event) => setRadius(Number(event.target.value))}>
                                        {[5, 10, 25, 50, 100, 200, 300, 400, 500].map((km) => (
                                            <option key={km} value={km}>{km} {t.nearby.radiusKm}</option>
                                        ))}
                                    </select>
                                </label>
                            ) : (
                                <label className="stack4">
                                    <span>{t.nearby.chooseCity}</span>
                                    <select className="input" value={selectedCity} onChange={(event) => setSelectedCity(event.target.value)}>
                                        <option value="">{t.nearby.chooseCity}</option>
                                        {cityOptions.map((city) => <option key={city} value={city}>{city}</option>)}
                                    </select>
                                </label>
                            )}
                            <label className="stack4">
                                <span>{t.home.searchPlaceholder}</span>
                                <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} />
                            </label>
                            <label className="stack4">
                                <span>{t.nearby.categoryLabel}</span>
                                <select className="input" value={category} onChange={(event) => setCategory(event.target.value as ListingCategory)}>
                                    {(Object.keys(t.categories) as ListingCategory[]).map((key) => <option key={key} value={key}>{t.categories[key]}</option>)}
                                </select>
                            </label>
                            <label className="stack4">
                                <span>{t.home.offerTypeLabel}</span>
                                <select className="input" value={offerType} onChange={(event) => setOfferType(event.target.value as OfferTypeFilter)}>
                                    {(['all', 'paid', 'free', 'exchange'] as const).map((value) => <option key={value} value={value}>{t.home.offerTypes[value]}</option>)}
                                </select>
                            </label>
                            <label className="stack4">
                                <span>{t.home.catalogCategoryLabel}</span>
                                <select className="input" value={catalogCategory} onChange={(event) => {
                                    const value = event.target.value
                                    setCatalogCategory(value === 'uncategorized' || isCatalogCategoryId(value) ? value : 'all')
                                    setCatalogSubcategory('')
                                }}>
                                    <option value="all">{t.home.allCatalogCategories}</option>
                                    <option value="uncategorized">{t.home.unclassifiedCategory}</option>
                                    {Object.keys(CATALOG_CATEGORIES).map((key) => <option key={key} value={key}>{t.catalogCategories[key as CatalogCategoryId]}</option>)}
                                </select>
                            </label>
                            <label className="stack4">
                                <span>{t.home.subcategoryLabel}</span>
                                <select className="input" disabled={!isCatalogCategoryId(catalogCategory)} value={catalogSubcategory} onChange={(event) => {
                                    const value = event.target.value
                                    setCatalogSubcategory(isCatalogCategoryId(catalogCategory) && isCatalogSubcategoryId(catalogCategory, value) ? value : '')
                                }}>
                                    <option value="">{t.home.allSubcategories}</option>
                                    {isCatalogCategoryId(catalogCategory) && getCatalogSubcategoryIds(catalogCategory).map((value) => <option key={value} value={value}>{t.catalogSubcategories[value]}</option>)}
                                </select>
                            </label>
                            <label className="stack4">
                                <span>{t.home.minPrice}</span>
                                <input className="input" inputMode="decimal" value={minPrice} aria-invalid={!!priceRangeError} onChange={(event) => setMinPrice(event.target.value)} />
                            </label>
                            <label className="stack4">
                                <span>{t.home.maxPrice}</span>
                                <input className="input" inputMode="decimal" value={maxPrice} aria-invalid={!!priceRangeError} onChange={(event) => setMaxPrice(event.target.value)} />
                            </label>
                            <label className="stack4">
                                <span>{t.home.sortLabel}</span>
                                <select className="input" value={sort} onChange={(event) => setSort(event.target.value as NearbySort)}>
                                    {geoStatus === 'ready' && <option value="distance">{t.nearby.sortDistance}</option>}
                                    {(['newest', 'oldest', 'priceAsc', 'priceDesc'] as const).map((value) => <option key={value} value={value}>{t.home.sortOptions[value]}</option>)}
                                </select>
                            </label>
                        </div>
                        {priceRangeError && <div className="home-filters__error" role="alert">{priceRangeError}</div>}
                        <div className="home-filters__count" aria-live="polite">{t.home.resultCount}: {nearbyAds.length}</div>
                    </FilterDisclosure>
                </div>
            </div>

            {nearbyAds.length === 0 ? (
                <div className="card home-empty-results">{emptyMessage}</div>
            ) : (
                <div className={`ads-grid ${view === 'list' ? 'ads-grid--list' : 'ads-grid--grid'}`}>
                    {nearbyAds.map((ad) => (
                        <Link key={ad.id} to={buildAdPath(ad.title, ad.city, ad.id)} className="nearby-ad-link">
                            <AdCard
                                ad={ad}
                                description={ad.distance !== undefined ? `${ad.distance.toFixed(1)} ${t.nearby.distanceFromYou}` : `${t.nearby.cityLabel}: ${ad.city}`}
                                userNickname={getAdSellerDisplayName(ad) || usersById[ad.userId]}
                                labels={t.adCard}
                            />
                        </Link>
                    ))}
                </div>
            )}
        </div>
    )
}

export default NearbyPage
