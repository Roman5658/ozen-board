import type { Ad } from '../types/ad'
import { getAdImages } from '../utils/getAdImages'

type Props = {
    // 🔹 новый путь (предпочтительный)
    ad?: Ad

    // 🔹 старый путь (оставляем для совместимости)
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


}

function formatDate(ts?: number) {
    if (!ts) return '—'
    const diff = Date.now() - ts
    const oneDay = 24 * 60 * 60 * 1000

    if (diff < oneDay) return 'Сьогодні'
    if (diff < 2 * oneDay) return 'Вчора'

    return new Date(ts).toLocaleDateString('uk-UA')
}

function AdCard(props: Props) {
    // 🔹 если пришёл ad — берём данные из него
    const ad = props.ad

    const title = ad?.title ?? props.title ?? ''
    const price = ad?.price ?? props.price
    const city = ad?.city ?? props.city
    const description = ad?.description ?? props.description
    const createdAt = ad?.createdAt ?? props.createdAt

    const now = Date.now()

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

    // ⚠️ getAdImages вызываем ТОЛЬКО здесь — не в HomePage
    const images = ad ? getAdImages(ad) : props.images
    const preview = images?.[0]

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
                        📷 Немає фото
                    </div>
                )}
            </div>

            <div className="ad-header">
                <h3 className="ad-title">{title}</h3>

                {userId && (
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                        <span
                            onClick={(e) => {
                                e.stopPropagation()
                                window.location.href = `/user/${userId}`
                            }}
                            style={{
                                color: '#1976d2',
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            {props.userNickname ?? 'Користувач'}
                        </span>
                    </div>
                )}

                {isPinActive && !props.isSoftPinned && (
                    <span
                        className="ad-badge"
                        style={{ background: '#2563eb' }}
                    >
        {ad?.pinType === 'top3' ? 'TOP 3' : 'TOP 6'}
    </span>
                )}


                {isInPinQueue && props.isMine && (
                    <span className="ad-badge" style={{ background: '#6b7280' }}>
    В черзі
  </span>
                )}


                {isHighlightActive && (
                    <span
                        className="ad-badge"
                        style={{ background: '#f59e0b', color: '#000' }}
                    >
        GOLD
    </span>
                )}

                {props.isMine && <span className="ad-badge mine">МОЄ</span>}

            </div>

            {description && <p className="ad-desc">{description}</p>}

            <div className="ad-footer">
                <span className="ad-city">{city}</span>
                {price && <span className="ad-price">{price}</span>}
            </div>

            <div className="ad-meta">
                <span>🕒 {formatDate(createdAt)}</span>
                <span>✔️ Безпечна угода</span>
            </div>

            {props.isMine && props.showActions && props.onDelete && (
                <button
                    className="btn-danger"
                    type="button"
                    onClick={(e) => {
                        e.preventDefault()
                        props.onDelete?.()
                    }}
                >
                    Видалити
                </button>
            )}
        </div>
    )
}

export default AdCard
