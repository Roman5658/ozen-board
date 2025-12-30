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
    const isPremium = ad?.isPremium ?? props.isPremium
    const isPinned = ad?.isPinned ?? props.isPinned
    const highlightType = ad?.highlightType ?? props.highlightType
    const userId = ad?.userId ?? props.userId

    // ⚠️ getAdImages вызываем ТОЛЬКО здесь — не в HomePage
    const images = ad ? getAdImages(ad) : props.images
    const preview = images?.[0]

    return (
        <div
            className={`ad-card ${isPremium ? 'premium' : ''}`}
            style={{
                border:
                    highlightType === 'gold'
                        ? '2px solid #f59e0b'
                        : highlightType === 'blue'
                            ? '2px solid #3b82f6'
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

                {isPremium && <span className="ad-badge">TOP</span>}
                {props.isMine && <span className="ad-badge mine">МОЄ</span>}
                {isPinned && (
                    <span className="ad-badge" style={{ background: '#2563eb' }}>
                        PIN
                    </span>
                )}
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
