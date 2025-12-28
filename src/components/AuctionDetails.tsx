import { useState } from 'react'
import { placeBid } from '../data/placeBid'
import { useNavigate } from 'react-router-dom'


type Bid = {
    id: string
    userId: string
    userName: string
    nickname?: string
    amount: number
    createdAt: number
}

type Seller = {
    id: string
    name: string
    karma: number
}

type Props = {
    title: string
    city: string
    description?: string
    images?: string[]
    currentBid: number
    timeLeft: string
    bids: Bid[]
    isAuthenticated: boolean
    seller?: Seller
    auctionId: string
    onBack: () => void
    currentUserId: string | null
    onBidSuccess: () => void

}

function AuctionDetails({
                            title,
                            city,
                            description,
                            images,
                            currentBid,
                            timeLeft,
                            bids,
                            isAuthenticated,
                            seller,
                            auctionId,
                            onBack,
                            currentUserId,
                            onBidSuccess,
                        }: Props) {
    const [amount, setAmount] = useState('')
    const [error, setError] = useState('')
    const [isReportOpen, setIsReportOpen] = useState(false)
    const [reportText, setReportText] = useState('')
    const [reportSent, setReportSent] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const navigate = useNavigate()

    const isEnded = timeLeft === 'Завершено'
    const isAuthor =
        isAuthenticated &&
        currentUserId &&
        seller?.id &&
        currentUserId === seller.id

    function submitReport() {
        const text = reportText.trim()
        if (!text) return

        try {
            const key = 'ozen_reports'
            const raw = localStorage.getItem(key)
            const current = raw ? JSON.parse(raw) : []

            current.unshift({
                id: Date.now(),
                auctionId: auctionId ?? null,
                title,
                sellerId: seller?.id ?? null,
                sellerName: seller?.name ?? null,
                reason: text,
                createdAt: Date.now(),
            })

            localStorage.setItem(key, JSON.stringify(current))
        } catch {
            // ignore
        }

        setReportSent(true)
        setIsReportOpen(false)
        setReportText('')
    }

    async function placeBidHandler() {
        if (!currentUserId || !seller) return

        const value = Number(amount)

        if (!value || value <= currentBid) {
            setError('Ставка повинна бути більшою за поточну')
            return
        }

        setIsSubmitting(true)
        setError('')

        try {
            await placeBid({
                auctionId,
                userId: currentUserId,
                userName: seller?.name ?? 'Користувач'
                ,

                amount: value,
            })

            setAmount('')
            onBidSuccess()

        } catch (e) {
            if (e instanceof Error) {
                setError(e.message)
            } else {
                setError('Помилка при створенні ставки')
            }
        }
        finally {
            setIsSubmitting(false)
        }
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

            {images && images.length > 0 && (
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '12px 0' }}>
                    {images.map((img, idx) => (
                        <img
                            key={idx}
                            src={img}
                            alt=""
                            style={{
                                width: 120,
                                height: 120,
                                objectFit: 'cover',
                                borderRadius: 8,
                                flexShrink: 0,
                            }}
                        />
                    ))}
                </div>
            )}

            <div style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
                {city}
            </div>

            {description && (
                <div style={{ fontSize: 14, marginBottom: 12, lineHeight: 1.4 }}>
                    {description}
                </div>
            )}

            <div
                style={{
                    padding: 12,
                    borderRadius: 12,
                    background: '#fff',
                    border: '1px solid #eee',
                    marginBottom: 12,
                }}
            >
                <div style={{fontSize: 13, color: '#555', marginBottom: 6}}>
                    Продавець
                </div>

                <div style={{display: 'flex', justifyContent: 'space-between', gap: 8}}>
                    <div>
                        <div
                            style={{fontWeight: 600, cursor: 'pointer', color: '#1976d2'}}
                            onClick={() => navigate(`/user/${seller?.id}`)}
                        >
                            {seller?.name ?? 'Користувач'}
                        </div>

                        <div style={{fontSize: 13, color: '#6b7280'}}>
                            Карма: {seller?.karma ?? 0}
                        </div>
                    </div>

                    <div style={{display: 'flex', gap: 8}}>
                        <button
                            type="button"
                            onClick={() => navigate(`/user/${seller?.id}`)}
                            style={{
                                padding: '10px 12px',
                                borderRadius: 10,
                                border: '1px solid #1976d2',
                                background: '#e3f2fd',
                                color: '#0d47a1',
                                fontWeight: 600,
                                cursor: 'pointer',
                            }}
                        >
                            Написати
                        </button>

                        <button
                            type="button"
                            onClick={() => setIsReportOpen(v => !v)}
                            style={{
                                padding: '10px 12px',
                                borderRadius: 10,
                                border: '1px solid #f59e0b',
                                background: '#fff7ed',
                                color: '#b45309',
                                fontWeight: 600,
                                cursor: 'pointer',
                            }}
                        >
                            Поскаржитися
                        </button>
                    </div>
                </div>


                {reportSent && (
                    <div style={{marginTop: 10, fontSize: 13, color: '#2e7d32'}}>
                        Скаргу надіслано
                    </div>
                )}

                {isReportOpen && (
                    <div style={{marginTop: 10}}>
                        <textarea
                            value={reportText}
                            onChange={e => setReportText(e.target.value)}
                            rows={4}
                            placeholder="Опиши причину скарги…"
                            style={{
                                width: '100%',
                                padding: 10,
                                borderRadius: 10,
                                border: '1px solid #ddd',
                                marginBottom: 8,
                            }}
                        />

                        <button
                            onClick={submitReport}
                            disabled={!reportText.trim()}
                            style={{
                                width: '100%',
                                padding: 12,
                                borderRadius: 10,
                                border: 'none',
                                background: reportText.trim() ? '#111827' : '#9ca3af',
                                color: '#fff',
                                fontWeight: 700,
                                cursor: reportText.trim() ? 'pointer' : 'not-allowed',
                            }}
                        >
                            Надіслати
                        </button>
                    </div>
                )}
            </div>

            <div style={{fontWeight: 600, marginBottom: 4}}>
                Поточна ставка: {currentBid} zł
            </div>

            <div style={{color: '#d32f2f', marginBottom: 12}}>
                До завершення: {timeLeft}
            </div>

            {!isEnded && (
                isAuthenticated ? (
                    isAuthor ? (
                        <div style={{padding: 12, background: '#eef2ff', borderRadius: 10}}>
                            Ви є автором цього аукціону і не можете робити ставки
                        </div>
                    ) : (
                        <div>
                            <input
                                type="number"
                                value={amount}
                                onChange={e => setAmount(e.target.value)}
                                placeholder="Ваша ставка (zł)"
                                style={{
                                    width: '100%',
                                    padding: 10,
                                    borderRadius: 8,
                                    border: `1px solid ${error ? '#d32f2f' : '#ccc'}`,
                                    marginBottom: 8,
                                }}
                            />

                            {error && (
                                <div style={{color: '#d32f2f', fontSize: 13}}>
                                    {error}
                                </div>
                            )}

                            <button
                                onClick={placeBidHandler}
                                disabled={isSubmitting}
                                style={{
                                    width: '100%',
                                    padding: 12,
                                    borderRadius: 10,
                                    border: 'none',
                                    background: isSubmitting ? '#9ca3af' : '#1976d2',
                                    color: '#fff',
                                    fontWeight: 600,
                                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {isSubmitting ? 'Зачекайте…' : 'Зробити ставку'}
                            </button>

                        </div>
                    )
                ) : (
                    <div style={{padding: 12, background: '#fff3e0', borderRadius: 10}}>
                        Щоб зробити ставку, необхідно увійти в акаунт
                    </div>
                )
            )}

            <h3 style={{marginTop: 16}}>Історія ставок</h3>

            {bids.length === 0 ? (
                <div style={{fontSize: 14, color: '#777' }}>
                    Ставок ще немає
                </div>
            ) : (
                bids.map(bid => (
                    <div key={bid.id} style={{ fontSize: 14 }}>
                        <span
                            style={{ color: '#1976d2', cursor: 'pointer', fontWeight: 600 }}
                            onClick={() => navigate(`/user/${bid.userId}`)}
                        >
    {bid.nickname ?? 'Користувач'}
</span>
                        : {bid.amount} zł

                    </div>
                ))
            )}
        </div>
    )
}

export default AuctionDetails
