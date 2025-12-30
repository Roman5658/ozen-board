type Props = {
    title: string
    city: string
    currentBid: number
    timeLeft: string
    image?: string
    view?: 'list' | 'grid'
    isEnded?: boolean
    promotionType?: "top-auction" | "featured" | "highlight-gold" | "none"
}


function AuctionCard({
                         title,
                         city,
                         currentBid,
                         timeLeft,
                         isEnded,
                         image,
                         view = 'list',
                         promotionType,
                     }: Props) {
    const isGrid = view === 'grid'

    return (
        <div
            style={{
                borderRadius: '12px',
                padding: '12px',
                display: isGrid ? 'block' : 'flex',
                gap: isGrid ? undefined : '12px',
                overflow: 'hidden',

                // ===== ВИЗУАЛЬНОЕ ВЫДЕЛЕНИЕ =====
                border:
                    promotionType === 'top-auction'
                        ? '2px solid #ef4444'
                        : promotionType === 'featured'
                            ? '2px solid #f59e0b'
                            : promotionType === 'highlight-gold'
                                ? '1px solid #facc15'
                                : '1px solid #ddd',


                boxShadow:
                    promotionType === 'top-auction'
                        ? '0 6px 16px rgba(239, 68, 68, 0.25)'
                        : promotionType === 'featured'
                            ? '0 4px 12px rgba(245, 158, 11, 0.25)'
                            : promotionType === 'highlight-gold'
                                ? '0 3px 10px rgba(250, 204, 21, 0.35)'
                                : 'none',


                background:
                    promotionType === 'highlight-gold'
                        ? 'linear-gradient(135deg, #fff7cc, #fffbeb)'
                        : '#fff',

                transform:
                    promotionType === 'top-auction' ? 'translateY(-2px)' : 'none',

            }}
        >

            {/* Фото */}
            <div
                style={{
                    width: isGrid ? '100%' : '96px',
                    height: isGrid ? '140px' : '96px',
                    borderRadius: '8px',
                    background: '#f2f2f2',
                    marginBottom: isGrid ? '8px' : 0,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    color: '#888',
                    overflow: 'hidden',
                }}
            >
                {image ? (
                    <img
                        src={image}
                        alt={title}
                        style={{
                            width: '100%',
                            objectFit: 'cover',
                        }}
                    />
                ) : (
                    'Немає фото'
                )}
            </div>

            {/* Контент */}
            <div
                style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                }}
            >
                <div>
                    {promotionType === "top-auction" && (
                        <div style={{fontSize: 12, color: "#d32f2f", fontWeight: 600}}>
                            🔥 TOP
                        </div>
                    )}

                    {promotionType === "featured" && (
                        <div style={{fontSize: 12, color: "#f59e0b", fontWeight: 600}}>
                            ⭐ Featured
                        </div>
                    )}
                    {promotionType === "highlight-gold" && (
                        <div style={{fontSize: 12, color: "#b45309", fontWeight: 600}}>
                            ✨ Gold
                        </div>
                    )}


                    <h3
                        style={{
                            margin: 0,
                            fontSize: '16px',
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            wordBreak: 'break-word',
                        }}
                    >
                        {title}
                    </h3>

                    <div style={{fontSize: '14px', marginTop: '6px', color: '#555'}}>
                        {city}
                    </div>
                </div>

                <div>
                    <div style={{marginTop: '8px', fontWeight: 600}}>
                        Поточна ставка: {currentBid} zł
                    </div>

                    <div
                        style={{
                            marginTop: '6px',
                            fontSize: '13px',
                            color: isEnded ? '#888' : '#d32f2f',
                        }}
                    >
                        {isEnded ? 'Аукціон завершено' : `До завершення: ${timeLeft}`}
                    </div>
                    {isEnded && (
                        <div
                            style={{
                                marginTop: '4px',
                                fontSize: '12px',
                                color: '#888',
                            }}
                        >
                            Завершений аукціон буде видалено через 5 днів
                        </div>
                    )}

                </div>
            </div>
        </div>
    )
}

export default AuctionCard
