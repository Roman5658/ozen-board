/* eslint-disable react-hooks/purity */
import type { Ad } from '../types/ad'
import { getAdImages } from '../utils/getAdImages'
import { useMemo } from 'react'
import { formatPricePLN } from '../utils/formatPricePLN'

type Props = {
    ad?: Ad

    title?: string
    price?: string
    city?: string
    description?: string
    images?: string[]
    isPremium?: boolean
    createdAt?: number

    userId?: string
    userNickname?: string
    isSoftPinned?: boolean

    isMine?: boolean
    showActions?: boolean
    onDelete?: () => void
    isPinned?: boolean
    highlightType?: 'gold' | 'blue'

    labels?: {
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

function formatDate(
    ts?: number,
    now?: number,
    labels?: { today: string; yesterday: string }
) {
    if (!ts || !now) return '—'

    const diff = now - ts
    const oneDay = 24 * 60 * 60 * 1000

    if (diff < oneDay) return labels?.today ?? '—'
    if (diff < 2 * oneDay) return labels?.yesterday ?? '—'

    return new Date(ts).toLocaleDateString('uk-UA')
}

function AdCard(props: Props) {
    const ad = props.ad

    const title = ad?.title ?? props.title ?? ''
    const price = ad?.price ?? props.price
    const city = ad?.city ?? props.city
    const description = ad?.description ?? props.description
    const createdAt = ad?.createdAt ?? props.createdAt

    const now = useMemo(() => Date.now(), [])

    const isPinActive =
        !!ad?.pinType &&
        !!ad?.pinnedUntil &&
        ad.pinnedUntil > now

    const isTop3 = isPinActive && ad?.pinType === 'top3' && !props.isSoftPinned
    const isTop6 = isPinActive && ad?.pinType === 'top6' && !props.isSoftPinned

    const isInPinQueue =
        !!ad?.pinQueueAt &&
        (!ad?.pinnedUntil || ad.pinnedUntil <= now)

    const isHighlightActive =
        !!ad?.highlightUntil &&
        ad.highlightUntil > now

    const highlightType =
        isHighlightActive
            ? ad?.highlightType ?? props.highlightType
            : undefined

    const userId = ad?.userId ?? props.userId

    const images = ad ? getAdImages(ad) : props.images
    const preview = images?.[0]

    const formattedDate = useMemo(
        () => formatDate(createdAt, now, props.labels),
        [createdAt, now, props.labels]
    )

    return (
        <div
            className="ad-card"
            style={{
                border:
                    isTop3
                        ? '2px solid #ef4444'
                        : isTop6
                            ? '2px solid #22c55e'
                            : props.isSoftPinned
                                ? '1px dashed #16a34a'
                                : highlightType === 'gold'
                                    ? '5px solid #f59e0b'
                                    : highlightType === 'blue'
                                        ? '2px solid #3b82f6'
                                        : undefined,

                boxShadow:
                    isTop3
                        ? '0 0 12px rgba(239, 68, 68, 0.75)'
                        : isTop6
                            ? '0 0 12px rgba(34, 197, 94, 0.75)'
                            : undefined,

                background:
                    highlightType === 'gold'
                        ? '#fffbeb'
                        : highlightType === 'blue'
                            ? '#eff6ff'
                            : undefined,
            }}
        >
            <div className="ad-image">
                {preview ? (
                    <img src={preview} alt={title} />
                ) : (
                    <div className="ad-image-placeholder">
                        {props.labels?.noPhoto ?? '—'}
                    </div>
                )}
            </div>

            <div className="ad-header">
                <h3 className="ad-title">{title}</h3>

                {userId && (
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                        <span
                            onClick={e => {
                                e.stopPropagation()
                                window.location.href = `/user/${userId}`
                            }}
                            style={{
                                color: '#1976d2',
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            {props.userNickname ?? props.labels?.user ?? '—'}
                        </span>
                    </div>
                )}

                {isPinActive && !props.isSoftPinned && (
                    <span className="ad-badge" style={{ background: '#2563eb' }}>
                        {ad?.pinType === 'top3'
                            ? props.labels?.top3
                            : props.labels?.top6}
                    </span>
                )}

                {isInPinQueue && props.isMine && (
                    <span className="ad-badge" style={{ background: '#6b7280' }}>
                        {props.labels?.inQueue}
                    </span>
                )}

                {isHighlightActive && (
                    <span className="ad-badge" style={{ background: '#f59e0b', color: '#000' }}>
                        {props.labels?.gold}
                    </span>
                )}

                {props.isMine && (
                    <span className="ad-badge mine">
                        {props.labels?.mine}
                    </span>
                )}
            </div>

            {description && <p className="ad-desc">{description}</p>}

            <div className="ad-footer">
                <span className="ad-city">{city}</span>
                {price && <span className="ad-price">{formatPricePLN(price)}</span>}
            </div>

            <div className="ad-meta">
                <span>🕒 {formattedDate}</span>
                <span>{props.labels?.safeDeal}</span>
            </div>

            {props.isMine && props.showActions && props.onDelete && (
                <button
                    className="btn-danger"
                    type="button"
                    onClick={e => {
                        e.preventDefault()
                        props.onDelete?.()
                    }}
                >
                    {props.labels?.delete}
                </button>
            )}
        </div>
    )
}

export default AdCard
