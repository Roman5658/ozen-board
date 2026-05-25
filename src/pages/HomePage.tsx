/* eslint-disable react-hooks/purity */

import type { Ad } from '../types/ad'

import AdCard from '../components/AdCard'
import CategoryFilter from '../components/CategoryFilter'
import VoivodeshipFilter from '../components/VoivodeshipFilter'
import CityByVoivodeshipFilter from '../components/CityByVoivodeshipFilter'
import { Link, useLocation } from 'react-router-dom'
import { getLocalUser } from '../data/localUser'

import { useEffect, useState, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../app/firebase'
import { buildAdPath } from '../utils/slug'
import { useSeo, BASE_URL } from '../utils/seo'
import { getUserPublicNicknames } from '../data/usersPublic'

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

            top3: string
            top6: string
            inQueue: string
            gold: string
            mine: string

            safeDeal: string
            delete: string
        }

    }
}


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

function isActivePin(ad: Ad, now: number) {
    return (
        ad.status === 'active' &&
        !!ad.pinType &&
        typeof ad.pinnedUntil === 'number' &&
        ad.pinnedUntil > now
    )
}

function prioritizeCityDiversity<T extends { id: string; city: string }>(ads: T[]): T[] {
    const selected: T[] = []
    const selectedIds = new Set<string>()
    const seenCities = new Set<string>()

    for (const ad of ads) {
        if (seenCities.has(ad.city)) continue
        seenCities.add(ad.city)
        selected.push(ad)
        selectedIds.add(ad.id)
    }

    for (const ad of ads) {
        if (selectedIds.has(ad.id)) continue
        selected.push(ad)
    }

    return selected
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

    const [voivodeship, setVoivodeship] = useState<Voivodeship>('all')
    const [query, setQuery] = useState('')
    const [city, setCity] = useState('')
    const [fireAds, setFireAds] = useState<Ad[]>([])
    const [usersById, setUsersById] = useState<Record<string, string>>({})
    const [view, setView] = useState<'list' | 'grid'>(() => {
        const saved = localStorage.getItem('adsViewMode')
        return saved === 'list' ? 'list' : 'grid'
    })
    const PAGE_SIZE = 30
    const [page, setPage] = useState(1)
    const [isSeoTextVisible, setIsSeoTextVisible] = useState(false)
    const now = Date.now()
    const localUser = getLocalUser()
    const currentUserId = localUser?.id


    useEffect(() => {
        async function loadAds() {
            const snap = await getDocs(collection(db, 'ads'))
            const data: Ad[] = snap.docs.map(doc => ({
                id: doc.id,
                ...(doc.data() as Omit<Ad, 'id'>),
            }))
            setFireAds(data)
        }

        loadAds()
    }, [])

    useEffect(() => {
        const missingUserIds = fireAds
            .filter(ad => !ad.userNickname && !ad.userName)
            .map(ad => ad.userId)
            .filter((id): id is string => !!id && !usersById[id])

        if (missingUserIds.length === 0) return

        getUserPublicNicknames(missingUserIds, t.adCard.user)
            .then(names => setUsersById(prev => ({ ...prev, ...names })))
            .catch(error => console.warn('[home] failed to load user nicknames', error))
    }, [fireAds, t.adCard.user, usersById])

    function getAdUserNickname(ad: Ad): string | undefined {
        return ad.userNickname?.trim() || ad.userName?.trim() || usersById[ad.userId]
    }
    useEffect(() => {
        setPage(1)
    }, [category, voivodeship, city, query])
    useEffect(() => {
        localStorage.setItem('adsViewMode', view)
    }, [view])
    const filteredAndSortedAds = useMemo(() => {
        return fireAds
            .map(normalizeAd)
            .filter(ad => category === 'all' || ad.category === category)
            .filter(ad => voivodeship === 'all' || ad.voivodeship === voivodeship)
            .filter(ad => city === '' || ad.city === city)
            .filter(ad => ad.title.toLowerCase().includes(query.toLowerCase()))
            .sort((a, b) => {
                const aActivePin = isActivePin(a, now)
                const bActivePin = isActivePin(b, now)

                if (aActivePin && a.pinType === 'top3' && !(bActivePin && b.pinType === 'top3')) return -1
                if (!(aActivePin && a.pinType === 'top3') && bActivePin && b.pinType === 'top3') return 1

                if (aActivePin && a.pinType === 'top6' && !(bActivePin && b.pinType === 'top6')) return -1
                if (!(aActivePin && a.pinType === 'top6') && bActivePin && b.pinType === 'top6') return 1

                if ((b.bumpAt ?? 0) !== (a.bumpAt ?? 0)) {
                    return (b.bumpAt ?? 0) - (a.bumpAt ?? 0)
                }

                return b.createdAt - a.createdAt
            })
    }, [fireAds, category, voivodeship, city, query])

    const activePinnedAds = filteredAndSortedAds.filter(
        ad => isActivePin(ad, now)
    )

    const allTop3 = activePinnedAds.filter(ad => ad.pinType === "top3")
    const allTop6 = activePinnedAds.filter(ad => ad.pinType === "top6")


    const top3Ads =
        city === ""
            ? prioritizeCityDiversity(shuffle(allTop3)).slice(0, 3)
            : allTop3.filter(ad => ad.city === city).slice(0, 3)

    const top6Ads =
        city === ""
            ? shuffle(allTop6).slice(0, 6)
            : allTop6.filter(ad => ad.city === city).slice(0, 6)
    const bumpAds = filteredAndSortedAds.filter(
        ad =>
            ad.status === "active" &&
            !ad.pinType &&
            ad.bumpAt
    )

    const regularAds = filteredAndSortedAds.filter(ad => {
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
    })



    const totalPages = Math.ceil(regularAds.length / PAGE_SIZE)

    const pagedRegularAds = regularAds.slice(
        (page - 1) * PAGE_SIZE,
        page * PAGE_SIZE
    )
    function shuffle<T>(arr: T[]): T[] {
        return [...arr].sort(() => Math.random() - 0.5)
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

            <div className="card stack8" style={{marginBottom: 14}}>
                <input
                    className="input"
                    placeholder={t.home.searchPlaceholder}

                    value={query}
                    onChange={e => setQuery(e.target.value)}
                />

                <div style={{display: 'flex', gap: 8}}>
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

                <VoivodeshipFilter
                    value={voivodeship}
                    onChange={v => {
                        setVoivodeship(v)
                        setCity('')
                    }}
                    t={t}
                />

                <CityByVoivodeshipFilter
                    voivodeship={voivodeship}
                    value={city}
                    onChange={setCity}
                    t={{allCities: t.home.allCities}}
                />


                <CategoryFilter value={category} onChange={setCategory} t={t}/>
            </div>

            <div className={`ads-grid ${view === 'list' ? 'ads-grid--list' : 'ads-grid--grid'}`}>

                {top3Ads.length > 0 && (
                    <div className="ads-separator">{t.home.top3}</div>

                )}
                {top3Ads.map(ad => (
                    <Link key={ad.id} to={buildAdPath(ad.title, ad.city, ad.id)} style={{textDecoration: 'none'}}>
                        <AdCard
                            ad={ad}
                            isMine={ad.userId === currentUserId}
                            userNickname={getAdUserNickname(ad)}
                            labels={t.adCard}
                        />


                    </Link>
                ))}

                {top6Ads.length > 0 && (
                    <div className="ads-separator">{t.home.top6}</div>

                )}
                {top6Ads.map(ad => (
                    <Link key={ad.id} to={buildAdPath(ad.title, ad.city, ad.id)} style={{textDecoration: 'none'}}>
                        <AdCard
                            ad={ad}
                            isMine={ad.userId === currentUserId}
                            userNickname={getAdUserNickname(ad)}

                            labels={t.adCard}
                        />


                    </Link>
                ))}

                {bumpAds.length > 0 && (
                    <div className="ads-separator">{t.home.bumped}</div>

                )}
                {bumpAds.map(ad => (
                    <Link key={ad.id} to={buildAdPath(ad.title, ad.city, ad.id)} style={{textDecoration: 'none'}}>
                        <AdCard
                            ad={ad}
                            isMine={ad.userId === currentUserId}
                            userNickname={getAdUserNickname(ad)}

                            labels={t.adCard}
                        />


                    </Link>
                ))}

                {regularAds.length > 0 && (
                    <div className="ads-separator">{t.home.regular}</div>

                )}
                {pagedRegularAds.map(ad => (
                    <Link key={ad.id} to={buildAdPath(ad.title, ad.city, ad.id)} style={{textDecoration: 'none'}}>
                        <AdCard
                            ad={ad}
                            isMine={ad.userId === currentUserId}
                            userNickname={getAdUserNickname(ad)}
                            labels={t.adCard}
                        />

                    </Link>
                ))}


            </div>
            {totalPages > 1 && (
                <div style={{display: "flex", justifyContent: "center", gap: 8, margin: "20px 0"}}>
                    <button
                        className="btn-secondary"
                        disabled={page === 1}
                        onClick={() => setPage(p => p - 1)}
                    >
                        {t.home.prev}

                    </button>

                    <div style={{alignSelf: "center", fontSize: 14}}>
                        {t.home.page} {page} {t.home.of} {totalPages}

                    </div>

                    <button
                        className="btn-secondary"
                        disabled={page === totalPages}
                        onClick={() => setPage(p => p + 1)}
                    >
                        {t.home.next}

                    </button>

                </div>
            )}

        </div>
    )
}

export default HomePage
