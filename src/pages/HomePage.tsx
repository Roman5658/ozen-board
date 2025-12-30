import type { Ad } from '../types/ad'

import AdCard from '../components/AdCard'
import CategoryFilter from '../components/CategoryFilter'
import VoivodeshipFilter from '../components/VoivodeshipFilter'
import CityByVoivodeshipFilter from '../components/CityByVoivodeshipFilter'
import { Link } from 'react-router-dom'

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

    const top3Ads = filteredAndSortedAds.filter(ad => ad.pinType === 'top3')
    const top6Ads = filteredAndSortedAds.filter(ad => ad.pinType === 'top6')
    const bumpAds = filteredAndSortedAds.filter(ad => !ad.pinType && ad.bumpAt)
    const regularAds = filteredAndSortedAds.filter(ad => !ad.pinType && !ad.bumpAt)

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
                        <AdCard ad={ad}/>
                    </Link>
                ))}

                {top6Ads.length > 0 && (
                    <div className="ads-separator">⭐ TOP 6</div>
                )}
                {top6Ads.map(ad => (
                    <Link key={ad.id} to={`/ad/${ad.id}`} style={{textDecoration: 'none'}}>
                        <AdCard ad={ad}/>
                    </Link>
                ))}

                {bumpAds.length > 0 && (
                    <div className="ads-separator">🚀 Підняті</div>
                )}
                {bumpAds.map(ad => (
                    <Link key={ad.id} to={`/ad/${ad.id}`} style={{textDecoration: 'none'}}>
                        <AdCard ad={ad}/>
                    </Link>
                ))}

                {regularAds.length > 0 && (
                    <div className="ads-separator">📄 Інші оголошення</div>
                )}
                {regularAds.map(ad => (
                    <Link key={ad.id} to={`/ad/${ad.id}`} style={{textDecoration: 'none'}}>
                        <AdCard ad={ad}/>
                    </Link>
                ))}

            </div>

        </div>
    )
}

export default HomePage
