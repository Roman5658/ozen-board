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
    const now = Date.now()

    useEffect(() => {
        if (!user) {
            navigate('/account')
            return
        }

        const userId = String(user.id)

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
                ads.map(ad => {
                    const isPinActive =
                        !!ad.pinType &&
                        !!ad.pinnedUntil &&
                        ad.pinnedUntil > now

                    const isInQueue =
                        !!ad.pinType &&
                        !!ad.pinQueueAt &&
                        (!ad.pinnedUntil || ad.pinnedUntil <= now)

                    const isHighlightActive =
                        !!ad.highlightUntil &&
                        ad.highlightUntil > now

                    return (
                        <div key={ad.id} className="card stack8">
                            <Link
                                to={`/ad/${ad.id}`}
                                style={{ textDecoration: 'none', color: 'inherit' }}
                            >
                                <strong>{ad.title}</strong>
                            </Link>

                            <div style={{ fontSize: 14, color: '#6b7280' }}>
                                {ad.city} · {ad.voivodeship}
                            </div>

                            {/* СТАТУСИ */}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <span className="ad-badge">Активне</span>

                                {isPinActive && (
                                    <span
                                        className="ad-badge"
                                        style={{ background: '#2563eb' }}
                                    >
                                        {ad.pinType === 'top3' ? 'TOP 3' : 'TOP 6'}
                                    </span>
                                )}

                                {isInQueue && (
                                    <span
                                        className="ad-badge"
                                        style={{ background: '#6b7280' }}
                                    >
                                        В черзі
                                    </span>
                                )}

                                {isHighlightActive && (
                                    <span
                                        className="ad-badge"
                                        style={{
                                            background: '#f59e0b',
                                            color: '#000',
                                        }}
                                    >
                                        GOLD
                                    </span>
                                )}
                            </div>

                            {/* ДАТИ */}
                            <div style={{ fontSize: 12, color: '#6b7280' }}>
                                {isPinActive && ad.pinnedUntil && (
                                    <div>
                                        TOP до{' '}
                                        {new Date(ad.pinnedUntil).toLocaleDateString()}
                                    </div>
                                )}

                                {isInQueue && ad.pinQueueAt && (
                                    <div>
                                        В черзі з{' '}
                                        {new Date(ad.pinQueueAt).toLocaleDateString()}
                                    </div>
                                )}

                                {isHighlightActive && ad.highlightUntil && (
                                    <div>
                                        Виділення до{' '}
                                        {new Date(ad.highlightUntil).toLocaleDateString()}
                                    </div>
                                )}
                            </div>

                            {/* КНОПКИ */}
                            <div style={{ display: 'flex', gap: 8 }}>
                                <Link to={`/ad/${ad.id}`} className="btn-secondary">
                                    Переглянути
                                </Link>

                                <button
                                    className="btn-secondary"
                                    style={{
                                        background: '#fee2e2',
                                        color: '#991b1b',
                                    }}
                                    onClick={() => handleDelete(ad.id)}
                                >
                                    Видалити
                                </button>
                            </div>
                        </div>
                    )
                })
            )}
        </div>
    )
}

export default MyAdsPage
