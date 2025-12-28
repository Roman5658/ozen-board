import { Link } from "react-router-dom"


type Props = {


    title: string
    price?: string
    city?: string
    description?: string
    image?: string
    isPremium?: boolean
    createdAt?: number

    userId?: string        // 👈 ДОБАВЛЯЕМ
    userNickname?: string // 👈 пока опционально (может быть undefined)

    isMine?: boolean
    showActions?: boolean
    onDelete?: () => void
}

function formatDate(ts?: number) {
    if (!ts) return '—'
    const diff = Date.now() - ts
    const oneDay = 24 * 60 * 60 * 1000

    if (diff < oneDay) return 'Сьогодні'
    if (diff < 2 * oneDay) return 'Вчора'

    return new Date(ts).toLocaleDateString('uk-UA')
}

function AdCard({
                    title,
                    price,
                    city,
                    description,
                    image,
                    isPremium,
                    createdAt,
                    isMine,
                    showActions,   // ✅ добавить
                    onDelete,
                    userId,          // 👈 ДОБАВИТЬ
                    userNickname,
                }: Props) {
    return (
        <div className={`ad-card ${isPremium ? 'premium' : ''}`}>

            <div className="ad-image">
                {image ? (
                    <img src={image} alt={title}/>
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
                        <Link
                            to={`/user/${userId}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                color: "#1976d2",
                                textDecoration: "none",
                                fontWeight: 500,
                            }}
                        >
                            {userNickname ?? "Користувач"}
                        </Link>
                    </div>
                )}

                {isPremium && (
                    <span className="ad-badge">TOP</span>
                )}
                {isMine && (
                    <span className="ad-badge mine">МОЄ</span>
                )}

            </div>

            {description && (
                <p className="ad-desc">{description}</p>
            )}

            <div className="ad-footer">
                <span className="ad-city">{city}</span>
                {price && <span className="ad-price">{price}</span>}
            </div>
            <div className="ad-meta">
                <span>🕒 {formatDate(createdAt)}</span>

                <span>✔️ Безпечна угода</span>
            </div>
            {isMine && showActions && onDelete && (
                <button
                    className="btn-danger"
                    type="button"
                    onClick={(e) => {
                        e.preventDefault() // чтобы Link не срабатывал, если карточка внутри <Link>
                        onDelete()
                    }}
                >
                    Видалити
                </button>
            )}

        </div>
    )
}

export default AdCard
