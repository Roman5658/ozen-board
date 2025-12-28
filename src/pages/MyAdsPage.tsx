import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore'

import { db } from '../app/firebase'
import { getLocalUser } from '../data/localUser'
import type { Ad } from '../types/ad'

function MyAdsPage() {
    const navigate = useNavigate()
    const user = getLocalUser()

    const [ads, setAds] = useState<Ad[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!user) {
            navigate('/account')
            return
        }

        const userId = String(user.id) // ✅ фикс для TS

        async function loadMyAds() {
            const snap = await getDocs(collection(db, 'ads'))

            const data: Ad[] = snap.docs
                .map(docSnap => ({
                    id: docSnap.id,
                    ...(docSnap.data() as Omit<Ad, 'id'>),
                }))
                .filter(ad => ad.userId === userId)

            setAds(data)
            setLoading(false)
        }

        loadMyAds()
    }, [user, navigate])

    async function handleDelete(adId: string) {
        const ok = confirm('Ви дійсно хочете видалити оголошення?')
        if (!ok) return

        await deleteDoc(doc(db, 'ads', adId))
        setAds(prev => prev.filter(ad => ad.id !== adId))
    }

    if (!user) {
        return <div className="card">Потрібно увійти</div>
    }

    if (loading) {
        return <div className="card">Завантаження…</div>
    }

    return (
        <div className="stack12">
            <h2 className="h2">Мої оголошення</h2>

            {ads.length === 0 ? (
                <div className="card">У вас ще немає оголошень</div>
            ) : (
                ads.map(ad => (
                    <div key={ad.id} className="card stack8">
                        <Link
                            to={`/ad/${ad.id}`}
                            style={{ textDecoration: 'none', color: 'inherit' }}
                        >
                            <strong>{ad.title}</strong>
                        </Link>

                        <div style={{ fontSize: '14px', color: '#6b7280' }}>
                            {ad.city} · {ad.voivodeship}
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                            <Link to={`/ad/${ad.id}`} className="btn-secondary">
                                Переглянути
                            </Link>

                            <button
                                className="btn-secondary"
                                style={{ background: '#fee2e2', color: '#991b1b' }}
                                onClick={() => handleDelete(ad.id)}
                            >
                                Видалити
                            </button>
                        </div>
                    </div>
                ))
            )}
        </div>
    )
}

export default MyAdsPage
