import type { Ad } from '../types/ad'

import AdCard from '../components/AdCard'
import CategoryFilter from '../components/CategoryFilter'
import VoivodeshipFilter from '../components/VoivodeshipFilter'
import CityByVoivodeshipFilter from '../components/CityByVoivodeshipFilter'
import { Link } from 'react-router-dom'
import { getLocalUser } from '../data/localUser'

import { useEffect, useState, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../app/firebase'

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
        categories: {
            all: string
            work: string
            buy: string
            sell: string
            service: string
            rent: string
        }
        voivodeships: Record<Voivodeship, string>
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

function HomePage({ t }: Props) {
    const [category, setCategory] = useState<
        'all' | 'work' | 'buy' | 'sell' | 'service' | 'rent'
    >('all')

    const [voivodeship, setVoivodeship] = useState<Voivodeship>('all')
    const [query, setQuery] = useState('')
    const [city, setCity] = useState('')
    const [fireAds, setFireAds] = useState<Ad[]>([])
    const [view, setView] = useState<'list' | 'grid'>('grid')
    const PAGE_SIZE = 30
    const [page, setPage] = useState(1)
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
        setPage(1)
    }, [category, voivodeship, city, query])

    const filteredAndSortedAds = useMemo(() => {
        return fireAds
            .map(normalizeAd)
            .filter(ad => category === 'all' || ad.category === category)
            .filter(ad => voivodeship === 'all' || ad.voivodeship === voivodeship)
            .filter(ad => city === '' || ad.city === city)
            .filter(ad => ad.title.toLowerCase().includes(query.toLowerCase()))
            .sort((a, b) => {
                if (a.pinType === 'top3' && b.pinType !== 'top3') return -1
                if (a.pinType !== 'top3' && b.pinType === 'top3') return 1

                if (a.pinType === 'top6' && b.pinType !== 'top6') return -1
                if (a.pinType !== 'top6' && b.pinType === 'top6') return 1

                if ((b.bumpAt ?? 0) !== (a.bumpAt ?? 0)) {
                    return (b.bumpAt ?? 0) - (a.bumpAt ?? 0)
                }

                return b.createdAt - a.createdAt
            })
    }, [fireAds, category, voivodeship, city, query])

    const activePinnedAds = filteredAndSortedAds.filter(
        ad =>
            ad.status === "active" &&
            ad.pinType &&
            ad.pinnedUntil &&
            ad.pinnedUntil > now
    )

    const allTop3 = activePinnedAds.filter(ad => ad.pinType === "top3")
    const allTop6 = activePinnedAds.filter(ad => ad.pinType === "top6")


    const top3Ads =
        city === ""
            ? shuffle(uniqueByCity(allTop3)).slice(0, 3)
            : allTop3.filter(ad => ad.city === city).slice(0, 3)

    const top6Ads =
        city === ""
            ? shuffle(allTop6).slice(0, 6)
            : allTop6.filter(ad => ad.city === city).slice(0, 6)
    const visibleTopIds = new Set([
        ...top3Ads.map(ad => ad.id),
        ...top6Ads.map(ad => ad.id),
    ])


    const bumpAds = filteredAndSortedAds.filter(
        ad =>
            ad.status === "active" &&
            !ad.pinType &&
            ad.bumpAt
    )

    const regularAds = filteredAndSortedAds.filter(ad => {
        if (ad.status !== 'active') return false
        if (ad.bumpAt) return false

        const isActivePin =
            !!ad.pinType &&
            !!ad.pinnedUntil &&
            ad.pinnedUntil > now

        // если объявление уже показано в TOP — не дублируем
        if (isActivePin && visibleTopIds.has(ad.id)) {
            return false
        }

        // сюда попадают:
        // • обычные
        // • в очереди
        // • активные TOP вне витрины
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

    function uniqueByCity<T extends { city: string }>(ads: T[]): T[] {
        const map = new Map<string, T>()
        for (const ad of ads) {
            if (!map.has(ad.city)) {
                map.set(ad.city, ad)
            }
        }
        return Array.from(map.values())
    }

    return (
        <div>
            <h2 className="h2">{t.homeTitle}</h2>

            <div className="card stack8" style={{marginBottom: 14}}>
                <input
                    className="input"
                    placeholder="Пошук оголошень"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                />

                <div style={{display: 'flex', gap: 8}}>
                    <button
                        className={view === 'list' ? 'btn-primary' : 'btn-secondary'}
                        onClick={() => setView('list')}
                    >
                        📄 Список
                    </button>
                    <button
                        className={view === 'grid' ? 'btn-primary' : 'btn-secondary'}
                        onClick={() => setView('grid')}
                    >
                        🔲 Сітка
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
                />

                <CategoryFilter value={category} onChange={setCategory} t={t}/>
            </div>

            <div className="ads-grid">

                {top3Ads.length > 0 && (
                    <div className="ads-separator">🔥 TOP 3</div>
                )}
                {top3Ads.map(ad => (
                    <Link key={ad.id} to={`/ad/${ad.id}`} style={{textDecoration: 'none'}}>
                        <AdCard
                            ad={ad}
                            isMine={ad.userId === currentUserId}
                        />

                    </Link>
                ))}

                {top6Ads.length > 0 && (
                    <div className="ads-separator">⭐ TOP 6</div>
                )}
                {top6Ads.map(ad => (
                    <Link key={ad.id} to={`/ad/${ad.id}`} style={{textDecoration: 'none'}}>
                        <AdCard
                            ad={ad}
                            isMine={ad.userId === currentUserId}
                        />

                    </Link>
                ))}

                {bumpAds.length > 0 && (
                    <div className="ads-separator">🚀 Підняті</div>
                )}
                {bumpAds.map(ad => (
                    <Link key={ad.id} to={`/ad/${ad.id}`} style={{textDecoration: 'none'}}>
                        <AdCard
                            ad={ad}
                            isMine={ad.userId === currentUserId}
                        />

                    </Link>
                ))}

                {regularAds.length > 0 && (
                    <div className="ads-separator">📄 Інші оголошення</div>
                )}
                {pagedRegularAds.map(ad => {
                    const isSoftPinned =
                        !!ad.pinType &&
                        !!ad.pinnedUntil &&
                        ad.pinnedUntil > now

                    return (
                        <Link key={ad.id} to={`/ad/${ad.id}`} style={{ textDecoration: 'none' }}>
                            <AdCard
                                ad={ad}
                                isMine={ad.userId === currentUserId}
                                isSoftPinned={isSoftPinned}
                            />
                        </Link>
                    )
                })}


            </div>
            {totalPages > 1 && (
                <div style={{ display: "flex", justifyContent: "center", gap: 8, margin: "20px 0" }}>
                    <button
                        className="btn-secondary"
                        disabled={page === 1}
                        onClick={() => setPage(p => p - 1)}
                    >
                        ← Назад
                    </button>

                    <div style={{ alignSelf: "center", fontSize: 14 }}>
                        Сторінка {page} з {totalPages}
                    </div>

                    <button
                        className="btn-secondary"
                        disabled={page === totalPages}
                        onClick={() => setPage(p => p + 1)}
                    >
                        Вперед →
                    </button>

                </div>
            )}

        </div>
    )
}

export default HomePage
