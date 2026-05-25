import { useEffect, useState, type ReactNode } from 'react'
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
    const account = translations[lang].account
    const moderation = account.moderation
    const myAdsText = account.myAds

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
        if (status === 'deleted') return moderation.statusDeletedByUser
        if (status === 'removed') return moderation.statusRemoved
        if (status === 'expired') return moderation.statusExpired
        if (status === 'pending_payment') return moderation.statusPendingPayment
        return moderation.statusActive
    }

    function formatDate(ts?: number | null) {
        return ts ? new Date(ts).toLocaleString(account.chats.timeLocale) : null
    }

    function getDateLabel(status?: string) {
        if (status === 'deleted') return moderation.dateDeleted
        if (status === 'removed') return moderation.dateRemoved
        if (status === 'hidden') return moderation.dateModerated
        if (status === 'expired') return moderation.dateExpired
        return moderation.date
    }

    function getStatusDate(ad: Ad) {
        if (ad.status === 'deleted') return ad.deletedAt
        if (ad.status === 'removed') return ad.removedAt ?? ad.moderatedAt
        if (ad.status === 'hidden') return ad.moderatedAt
        return null
    }

    function renderLongText(value?: string | null) {
        const text = value?.trim()
        if (!text) return null
        if (text.length <= 140) return <div>{text}</div>

        return (
            <details>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
                    {moderation.showDetails}
                </summary>
                <div style={{ marginTop: 6 }}>{text}</div>
            </details>
        )
    }

    function renderArchiveSection(title: string, items: Ad[], children: ReactNode) {
        if (items.length === 0) return null

        return (
            <details
                className="stack8"
                style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    padding: 12,
                    background: '#f9fafb',
                }}
            >
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
                    {title} ({items.length})
                </summary>
                <div className="stack8" style={{ marginTop: 10 }}>
                    {children}
                </div>
            </details>
        )
    }

    function renderArchivedAd(ad: Ad) {
        const date = formatDate(getStatusDate(ad))
        const reason = ad.moderationReason || ad.ownerNotificationMessage
        const showSupport = ad.status === 'hidden' || ad.status === 'removed'

        return (
            <div
                key={ad.id}
                className="stack8"
                style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    padding: 12,
                    background: '#fff',
                    fontSize: 14,
                }}
            >
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <Link to={buildAdPath(ad.title, ad.city, ad.id)} style={{ color: 'inherit', fontWeight: 700 }}>
                        {ad.title}
                    </Link>
                    <span className="ad-badge">{getStatusLabel(ad.status)}</span>
                </div>

                <div style={{ color: '#6b7280' }}>
                    {ad.city} · {ad.voivodeship}
                </div>

                {date && (
                    <div style={{ color: '#6b7280' }}>
                        {getDateLabel(ad.status)}: {date}
                    </div>
                )}

                {ad.status !== 'deleted' && reason && (
                    <div className="stack8">
                        <b>{moderation.reason}:</b>
                        {renderLongText(reason)}
                    </div>
                )}

                {showSupport && (
                    <div style={{ color: '#78350f' }}>
                        {moderation.contactSupport}
                    </div>
                )}
            </div>
        )
    }

    const activeAds = ads.filter(ad => (ad.status ?? 'active') === 'active')
    const hiddenAds = ads.filter(ad => ad.status === 'hidden')
    const deletedAds = ads.filter(ad => ad.status === 'deleted')
    const removedAds = ads.filter(ad => ad.status === 'removed')
    const expiredAds = ads.filter(ad => ad.status === 'expired')

    if (!user) {
        return <div className="card">Потрібно увійти</div>
    }

    if (loading) {
        return <div className="card">Завантаження…</div>
    }

    return (
        <div className="stack12">
            <h2 className="h2">{myAdsText.title}</h2>

            {activeAds.length === 0 ? (
                <div className="card">{ads.length === 0 ? myAdsText.empty : myAdsText.emptyActive}</div>
            ) : (
                activeAds.map(ad => {
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

            {renderArchiveSection(
                moderation.sections.hidden,
                hiddenAds,
                hiddenAds.map(renderArchivedAd)
            )}
            {renderArchiveSection(
                moderation.sections.deleted,
                deletedAds,
                deletedAds.map(renderArchivedAd)
            )}
            {renderArchiveSection(
                moderation.sections.removed,
                removedAds,
                removedAds.map(renderArchivedAd)
            )}
            {renderArchiveSection(
                moderation.sections.archivedAds,
                expiredAds,
                expiredAds.map(renderArchivedAd)
            )}
        </div>
    )
}

export default MyAdsPage
