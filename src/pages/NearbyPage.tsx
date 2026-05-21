import { useEffect, useMemo, useState } from 'react'
import AdCard from '../components/AdCard'
import type { Ad } from '../types/ad'

import { getDistanceKm } from '../utils/distance'
import { Link } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../app/firebase'
import { getAdImages } from '../utils/getAdImages'




type Props = {
    t: {
        nearbyTitle: string
    }
}
type GeoStatus = 'loading' | 'ready' | 'denied'
type NearbyAd = Ad & { distance?: number }

function NearbyPage({ t }: Props) {
    const [radius, setRadius] = useState(10)
    const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null)
    const [geoStatus, setGeoStatus] = useState<GeoStatus>('loading')
    const [selectedCity, setSelectedCity] = useState('')
    const [ads, setAds] = useState<Ad[]>([])
    const [view, setView] = useState<'list' | 'grid'>(() => {
        const saved = localStorage.getItem('nearbyAdsViewMode')
        return saved === 'list' ? 'list' : 'grid'
    })
    useEffect(() => {
        localStorage.setItem('nearbyAdsViewMode', view)
    }, [view])



    useEffect(() => {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setUserPos({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                })
                setGeoStatus('ready')
            },
            () => {
                setGeoStatus('denied')
            }
        )
    }, [])
    useEffect(() => {
        async function loadAds() {
            const snap = await getDocs(collection(db, 'ads'))

            const data: Ad[] = snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<Ad, 'id'>),
            }))



            setAds(data)
        }

        loadAds()
    }, [])

    const cityOptions = useMemo(
        () => Array.from(new Set(ads.map((ad) => ad.city).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
        [ads]
    )


    const nearbyAds = useMemo<NearbyAd[]>(() => {
        if (geoStatus === 'ready' && userPos) {
            return ads
                .filter((ad) => ad.location)
                .map((ad) => {
                    const { lat, lng } = ad.location!
                    return {
                        ...ad,
                        distance: getDistanceKm(userPos.lat, userPos.lng, lat, lng),
                    }
                })
                .filter((ad) => ad.distance <= radius)
                .sort((a, b) => a.distance - b.distance)
        }

        if (!selectedCity) return []
        return ads
            .filter((ad) => ad.city === selectedCity)
            .sort((a, b) => b.createdAt - a.createdAt)
    }, [ads, geoStatus, userPos, radius, selectedCity])

    if (geoStatus === 'loading') {
        return <div className="card">Визначаємо ваше місцезнаходження…</div>
    }


    return (
        <div>
            <h2 className="h2">{t.nearbyTitle}</h2>

            <div className="card stack8" style={{ marginBottom: '14px' }}>
                {geoStatus === 'ready' ? (
                    <select className="select" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
                        <option value={5}>5 км</option>
                        <option value={10}>10 км</option>
                        <option value={25}>25 км</option>
                        <option value={50}>50 км</option>
                        <option value={100}>100 км</option>
                        <option value={200}>200 км</option>
                        <option value={300}>300 км</option>
                        <option value={400}>400 км</option>
                        <option value={500}>500 км</option>
                    </select>
                ) : (
                    <>
                        <div style={{ color: '#6b7280' }}>Геолокація недоступна. Оберіть місто вручну:</div>
                        <select
                            className="select"
                            value={selectedCity}
                            onChange={(e) => setSelectedCity(e.target.value)}
                        >
                            <option value="">Виберіть місто</option>
                            {cityOptions.map((city) => (
                                <option key={city} value={city}>
                                    {city}
                                </option>
                            ))}
                        </select>
                    </>
                )}

                <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                    <button className={view === 'list' ? 'btn-primary' : 'btn-secondary'}
                            onClick={() => setView('list')}>
                        Список
                    </button>
                    <button className={view === 'grid' ? 'btn-primary' : 'btn-secondary'}
                            onClick={() => setView('grid')}>
                        Сетка
                    </button>
                </div>
            </div>

            {nearbyAds.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', color: '#6b7280' }}>
                    {geoStatus === 'ready'
                        ? 'Поблизу немає оголошень'
                        : 'Немає оголошень для вибраного міста'}
                </div>
            ) : (
                <div className={`ads-grid ${view === 'list' ? 'ads-grid--list' : 'ads-grid--grid'}`}>
                    {nearbyAds.map((ad) => (
                        <Link key={ad.id} to={`/ad/${ad.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                            <AdCard
                                title={ad.title}
                                description={ad.distance !== undefined ? `${ad.distance.toFixed(1)} км від вас` : `Місто: ${ad.city}`}
                                city={ad.city}
                                price={ad.price}
                                images={getAdImages(ad)}

                                isPremium={ad.isPremium}
                            />

                        </Link>
                    ))}

                </div>
            )}
        </div>
    )
}

export default NearbyPage
