type Props = {
    title: string
    price?: string
    city?: string
    description?: string
    image?: string
    isPremium?: boolean
    createdAt?: number
    isMine?: boolean
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

        </div>
    )
}

export default AdCard
