import { useState } from 'react'

type Bid = {
    user: string
    amount: number
}

type Props = {
    title: string
    city: string
    currentBid: number
    timeLeft: string
    bids: Bid[]
    isAuthenticated: boolean
    onBack: () => void
}

function AuctionDetails({
                            title,
                            city,
                            currentBid,
                            timeLeft,
                            bids,
                            isAuthenticated,
                            onBack,
                        }: Props) {
    const [amount, setAmount] = useState('')
    const [error, setError] = useState('')
    const [localBids, setLocalBids] = useState<Bid[]>(bids)
    const [current, setCurrent] = useState(currentBid)

    function placeBid() {
        const value = Number(amount)

        if (!value || value <= current) {
            setError('Ставка повинна бути більшою за поточну')
            return
        }

        setError('')
        setCurrent(value)
        setLocalBids([{ user: 'Ви', amount: value }, ...localBids])
        setAmount('')
    }

    return (
        <div>
            <button
                onClick={onBack}
                style={{
                    marginBottom: '12px',
                    background: 'none',
                    border: 'none',
                    color: '#1976d2',
                    cursor: 'pointer',
                    padding: 0,
                }}
            >
                ← Назад
            </button>

            <h2>{title}</h2>

            <div style={{ fontSize: '14px', color: '#555', marginBottom: '8px' }}>
                {city}
            </div>

            <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                Поточна ставка: {current} zł
            </div>

            <div style={{ color: '#d32f2f', marginBottom: '12px' }}>
                До завершення: {timeLeft}
            </div>

            {/* Форма ставки / предупреждение */}
            {isAuthenticated ? (
                <div style={{ marginBottom: '16px' }}>
                    <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="Ваша ставка (zł)"
                        style={{
                            width: '100%',
                            padding: '10px',
                            borderRadius: '8px',
                            border: '1px solid',
                            borderColor: error ? '#d32f2f' : '#ccc',
                            marginBottom: '8px',
                        }}
                    />

                    {error && (
                        <div style={{ color: '#d32f2f', fontSize: '13px', marginBottom: '8px' }}>
                            {error}
                        </div>
                    )}

                    <button
                        onClick={placeBid}
                        style={{
                            width: '100%',
                            padding: '12px',
                            borderRadius: '10px',
                            border: 'none',
                            background: '#1976d2',
                            color: '#fff',
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        Зробити ставку
                    </button>
                </div>
            ) : (
                <div
                    style={{
                        padding: '12px',
                        borderRadius: '10px',
                        background: '#fff3e0',
                        color: '#e65100',
                        fontSize: '14px',
                        marginBottom: '16px',
                    }}
                >
                    Щоб зробити ставку, необхідно увійти в акаунт
                </div>
            )}

            <h3 style={{ fontSize: '16px' }}>Історія ставок</h3>

            {localBids.length === 0 ? (
                <div style={{ color: '#777', fontSize: '14px' }}>
                    Ставок ще немає
                </div>
            ) : (
                localBids.map((bid, index) => (
                    <div
                        key={index}
                        style={{
                            padding: '8px 0',
                            borderBottom: '1px solid #eee',
                            fontSize: '14px',
                        }}
                    >
                        {bid.user}: {bid.amount} zł
                    </div>
                ))
            )}
        </div>
    )
}

export default AuctionDetails
