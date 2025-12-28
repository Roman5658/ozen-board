type Props = {
    title: string
    city: string
    currentBid: number
    timeLeft: string
    image?: string
    view?: 'list' | 'grid'
    isEnded?: boolean
}

function AuctionCard({
                         title,
                         city,
                         currentBid,
                         timeLeft,
                         isEnded,
                         image,
                         view = 'list',
                     }: Props) {
    const isGrid = view === 'grid'

    return (
        <div
            style={{
                border: '1px solid #ddd',
                borderRadius: '12px',
                padding: '12px',
                display: isGrid ? 'block' : 'flex',
                gap: isGrid ? undefined : '12px', // ✅ ВАЖНО
                overflow: 'hidden',
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

                    <div style={{ fontSize: '14px', marginTop: '6px', color: '#555' }}>
                        {city}
                    </div>
                </div>

                <div>
                    <div style={{ marginTop: '8px', fontWeight: 600 }}>
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
                </div>
            </div>
        </div>
    )
}

export default AuctionCard
