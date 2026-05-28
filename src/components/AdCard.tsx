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

    const title = props.title ?? ad?.title ?? ''
    const price = props.price ?? ad?.price
    const city = props.city ?? ad?.city
    const description = props.description ?? ad?.description
    const createdAt = ad?.createdAt ?? props.createdAt

    const now = useMemo(() => Date.now(), [])

    const isPinActive =
        !!ad?.pinType &&
        !!ad?.pinnedUntil &&
        ad.pinnedUntil > now

    const isTop3 = isPinActive && ad?.pinType === 'top3' && !props.isSoftPinned
    const isTop6 = isPinActive && ad?.pinType === 'top6' && !props.isSoftPinned

    const isInPinQueue =
        !isPinActive &&
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
    const userNickname = ad?.userNickname?.trim() || ad?.userName?.trim() || props.userNickname?.trim()

    const images = ad ? getAdImages(ad) : props.images
    const preview = images?.[0]

    const formattedDate = useMemo(
        () => formatDate(createdAt, now, props.labels),
        [createdAt, now, props.labels]
    )

    return (
        <div
            className="listing-card"
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
                        ? 'rgb(128 14 14 / 85%) 0px 20px 20px'
                        : isTop6
                            ? 'rgba(7, 97, 39, 0.45) 4px 20px 20px'
                            : highlightType === 'gold'
                                ? 'rgba(245, 158, 11, 0.45) 0px 20px 20px'
                                : highlightType === 'blue'
                                    ? 'rgba(59, 130, 246, 0.45) 0px 20px 20px'
                                    : undefined,

                background:
                    highlightType === 'gold'
                        ? '#fffbeb'
                        : highlightType === 'blue'
                            ? '#eff6ff'
                            : undefined,
            }}
        >
            <div className="listing-image">
                {preview ? (
                    <img src={preview} alt={title} />
                ) : (
                    <div className="listing-image-placeholder">
                        {props.labels?.noPhoto ?? '—'}
                    </div>
                )}
            </div>

            <div className="listing-header">
                <h3 className="listing-title">{title}</h3>

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
                            {userNickname ?? props.labels?.user ?? '—'}
                        </span>
                    </div>
                )}

                {isPinActive && !props.isSoftPinned && (
                    <span
                        className="listing-badge"
                        style={{
                            background: '#2563eb',
                            color: '#fff',
                            fontWeight: 800,
                            textShadow: '0 1px 2px rgba(0,0,0,0.35)',
                            boxShadow: '0 2px 8px rgba(37, 99, 235, 0.45)',
                        }}
                    >
    {ad?.pinType === 'top3'
        ? props.labels?.top3
        : props.labels?.top6}
</span>
                )}

                {isInPinQueue && props.isMine && (
                    <span className="listing-badge" style={{background: '#6b7280'}}>
                        {props.labels?.inQueue}
                    </span>
                )}

                {isHighlightActive && (
                    <span className="listing-badge" style={{ background: '#f59e0b', color: '#000' }}>
                        {props.labels?.gold}
                    </span>
                )}

                {props.isMine && (
                    <span className="listing-badge mine">
                        {props.labels?.mine}
                    </span>
                )}
            </div>

            {description && <p className="listing-desc">{description}</p>}

            <div className="listing-footer">
                <span className="listing-city">{city}</span>
                {price && <span className="listing-price">{formatPricePLN(price)}</span>}
            </div>

            <div className="listing-meta">
                <span>🕒 {formattedDate}</span>
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
