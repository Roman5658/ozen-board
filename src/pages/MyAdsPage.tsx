import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { collection, getDocs, updateDoc, doc } from 'firebase/firestore'

import { db } from '../app/firebase'
import { getLocalUser } from '../data/localUser'
import type { Ad } from '../types/ad'
import { DEFAULT_LANG, translations } from '../app/i18n'
import type { Lang } from '../app/i18n'
import { buildAdPath } from '../utils/slug'

function MyAdsPage() {
    const navigate = useNavigate()
    const user = getLocalUser()
    const lang = (localStorage.getItem('lang') as Lang) || DEFAULT_LANG
    const moderation = translations[lang].account.moderation

    const [ads, setAds] = useState<Ad[]>([])
    const [loading, setLoading] = useState(true)
    const [now] = useState(() => Date.now())

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
        if (!user) return

        const ok = confirm('Ви дійсно хочете видалити оголошення?')
        if (!ok) return

        const deletedAt = Date.now()
        const deletedBy = user.uid || user.id

        await updateDoc(doc(db, 'ads', adId), {
            status: 'deleted',
            deletedAt,
            deletedBy,
            deleteReason: 'user_deleted',
        })

        setAds(prev =>
            prev.map(ad =>
                ad.id === adId
                    ? { ...ad, status: 'deleted', deletedAt, deletedBy, deleteReason: 'user_deleted' }
                    : ad
            )
        )
    }

    function getStatusLabel(status?: string): string {
        if (status === 'hidden') return moderation.statusHidden
        if (status === 'deleted') return moderation.statusDeleted
        if (status === 'removed') return moderation.statusRemoved
        if (status === 'pending_payment') return moderation.statusPendingPayment
        return moderation.statusActive
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
                                to={buildAdPath(ad.title, ad.city, ad.id)}
                                style={{ textDecoration: 'none', color: 'inherit' }}
                            >
                                <strong>{ad.title}</strong>
                            </Link>

                            <div style={{ fontSize: 14, color: '#6b7280' }}>
                                {ad.city} · {ad.voivodeship}
                            </div>

                            {/* СТАТУСИ */}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <span className="ad-badge">{getStatusLabel(ad.status)}</span>

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

                            {(ad.status === 'hidden' || ad.status === 'deleted' || ad.status === 'removed' || ad.moderationReason || ad.ownerNotificationMessage) && (
                                <div
                                    className="card stack8"
                                    style={{
                                        border: ad.ownerNotificationStatus === 'unread' ? '2px solid #f59e0b' : '1px solid #fde68a',
                                        background: ad.ownerNotificationStatus === 'unread' ? '#fffbeb' : '#fff7ed',
                                        color: '#78350f',
                                        fontSize: 14,
                                    }}
                                >
                                    <div><b>{ad.ownerNotificationStatus === 'unread' ? moderation.unreadNotice : moderation.notice}</b></div>
                                    {ad.ownerNotificationMessage && <div>{ad.ownerNotificationMessage}</div>}
                                    {ad.moderationReason && <div><b>{moderation.reason}:</b> {ad.moderationReason}</div>}
                                    <div>{moderation.contactSupport}</div>
                                </div>
                            )}

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
                                <Link to={buildAdPath(ad.title, ad.city, ad.id)} className="btn-secondary">
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
