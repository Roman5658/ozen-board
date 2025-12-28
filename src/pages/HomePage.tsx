import type { Ad } from '../types/ad'

import AdCard from '../components/AdCard'
import CategoryFilter from '../components/CategoryFilter'
import VoivodeshipFilter from '../components/VoivodeshipFilter'
import CityByVoivodeshipFilter from '../components/CityByVoivodeshipFilter'
import { Link } from 'react-router-dom'
import { getLocalUser } from '../data/localUser'
import { useEffect, useState } from 'react'
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


function HomePage({ t }: Props) {
    const [category, setCategory] = useState<
        'all' | 'work' | 'buy' | 'sell' | 'service' | 'rent'
    >('all')

    const [voivodeship, setVoivodeship] = useState<Voivodeship>('all')
    const [query, setQuery] = useState('')
    const [city, setCity] = useState('')
    const [fireAds, setFireAds] = useState<Ad[]>([])


    const [view, setView] = useState<'list' | 'grid'>('grid')
    const user = getLocalUser()

    const allAds = [...fireAds]



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



    const filteredAds = allAds

        .filter(ad => category === 'all' || ad.category === category)
        .filter(ad => voivodeship === 'all' || ad.voivodeship === voivodeship)
        .filter(ad => city === '' || ad.city === city)
        .filter(ad =>
            ad.title.toLowerCase().includes(query.toLowerCase())
        )
        .sort((a, b) => {
            if (a.isPremium && !b.isPremium) return -1
            if (!a.isPremium && b.isPremium) return 1
            return 0
        })




    return (
        <div>
            <h2 className="h2">{t.homeTitle}</h2>

            <div className="card stack8" style={{marginBottom: '14px'}}>
                <input
                    className="input"
                    type="text"
                    placeholder="Пошук оголошень"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <div style={{display: 'flex', gap: '8px'}}>
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
                    onChange={(v) => {
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

                <CategoryFilter
                    value={category}
                    onChange={setCategory}
                    t={t}
                />
            </div>


            {filteredAds.length === 0 ? (
                <div className="card" style={{textAlign: 'center', color: '#6b7280'}}>
                    Нічого не знайдено за вибраними фільтрами
                </div>

            ) : (
                <div
                    className={view === 'grid' ? 'ads-grid' : 'stack12'}
                >

                    {filteredAds.map(ad => (
                        <Link
                            key={ad.id}
                            to={`/ad/${ad.id}`}
                            style={{textDecoration: 'none', color: 'inherit'}}
                        >
                            <AdCard
                                title={ad.title}
                                city={ad.city}
                                price={ad.price}
                                description={ad.description}
                                image={ad.image}
                                isPremium={ad.isPremium}
                                createdAt={ad.createdAt}
                                isMine={!!user && ad.userId === String(user.id)}

                            />
                        </Link>
                    ))}

                </div>
            )}


        </div>
    )
}

export default HomePage
