import { useEffect, useState } from 'react'
import AdCard from '../components/AdCard'
import type { Ad } from "../types/ad"

import { getDistanceKm } from '../utils/distance'
import { Link } from 'react-router-dom'
import { collection, getDocs } from "firebase/firestore"
import { db } from "../app/firebase"
import { getAdImages } from "../utils/getAdImages";




type Props = {
    t: {
        nearbyTitle: string
    }
}

function NearbyPage({ t }: Props) {
    const [radius, setRadius] = useState(10)
    const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null)
    const [error, setError] = useState('')
    const [ads, setAds] = useState<Ad[]>([])




    useEffect(() => {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setUserPos({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                })
            },
            () => {
                setError('Не вдалося отримати геолокацію')
            }
        )
    }, [])
    useEffect(() => {
        async function loadAds() {
            const snap = await getDocs(collection(db, "ads"))

            const data: Ad[] = snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<Ad, "id">),
            }))



            setAds(data)
        }

        loadAds()
    }, [])

    if (error) {
        return <div className="card">{error}</div>
    }

    if (!userPos) {
        return <div className="card">Визначаємо ваше місцезнаходження…</div>
    }

    const nearbyAds = ads


        .filter(ad => ad.location) // ⬅️ ВАЖНО
        .map(ad => {
            const { lat, lng } = ad.location!

            return {
                ...ad,
                distance: getDistanceKm(
                    userPos.lat,
                    userPos.lng,
                    lat,
                    lng
                ),
            }
        })
        .filter(ad => ad.distance <= radius)
        .sort((a, b) => a.distance - b.distance)


    return (
        <div>
            <h2 className="h2">{t.nearbyTitle}</h2>

            <div className="card stack8" style={{ marginBottom: '14px' }}>
                <select
                    className="select"
                    value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                >
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
            </div>

            {nearbyAds.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', color: '#6b7280' }}>
                    Поблизу немає оголошень
                </div>
            ) : (
                <div className="stack12">
                    {nearbyAds.map(ad => (
                        <Link
                            key={ad.id}
                            to={`/ad/${ad.id}`}
                            style={{ textDecoration: 'none', color: 'inherit' }}
                        >
                            <AdCard
                                title={`${ad.title} · ${ad.distance.toFixed(1)} км`}
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
