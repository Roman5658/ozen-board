type Props = {
    title: string
    city: string
    currentBid: number
    timeLeft: string
}

function AuctionCard({ title, city, currentBid, timeLeft }: Props) {
    return (
        <div
            style={{
                border: '1px solid #ddd',
                borderRadius: '12px',
                padding: '12px',
                marginBottom: '12px',
                background: '#fff',
            }}
        >
            <h3 style={{ margin: 0, fontSize: '16px' }}>{title}</h3>

            <div style={{ fontSize: '14px', marginTop: '6px', color: '#555' }}>
                {city}
            </div>

            <div style={{ marginTop: '8px', fontWeight: 600 }}>
                Поточна ставка: {currentBid} zł
            </div>

            <div
                style={{
                    marginTop: '6px',
                    fontSize: '13px',
                    color: '#d32f2f',
                }}
            >
                До завершення: {timeLeft}
            </div>
        </div>
    )
}

export default AuctionCard
