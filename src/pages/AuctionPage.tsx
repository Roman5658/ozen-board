import { useState } from 'react'
import AuctionCard from '../components/AuctionCard'
import AuctionDetails from '../components/AuctionDetails'
import { AUCTIONS } from '../data/auctions'
import { getTimeLeft } from '../utils/time'
import { translations, DEFAULT_LANG } from '../app/i18n'
import type { Lang } from '../app/i18n'




function AuctionPage() {


    const [city, setCity] = useState<'all' | string>('all')
    const [sort, setSort] = useState<'time' | 'bid'>('time')
    const [selectedAuction, setSelectedAuction] = useState<number | null>(null)
    const lang = (localStorage.getItem('lang') as Lang) || DEFAULT_LANG
    const t = translations[lang]

    const filteredAuctions = AUCTIONS
        .filter(a => city === 'all' || a.city === city)
        .sort((a, b) => {
            if (sort === 'bid') {
                return b.currentBid - a.currentBid
            }
            return new Date(a.endAt).getTime() - new Date(b.endAt).getTime()
        })

    const activeAuction = AUCTIONS.find(a => a.id === selectedAuction)
    const isAuthenticated = false // временно, потом заменим на auth.currentUser

    return (
        <div>
            <h2>{t.auctionTitle}</h2>

            {selectedAuction && activeAuction ? (
                <AuctionDetails
                    title={activeAuction.title}
                    city={activeAuction.city}
                    currentBid={activeAuction.currentBid}
                    timeLeft={getTimeLeft(activeAuction.endAt)}
                    bids={[
                        { user: 'Ivan', amount: activeAuction.currentBid - 100 },
                        { user: 'Oleh', amount: activeAuction.currentBid },
                    ]}
                    isAuthenticated={isAuthenticated}
                    onBack={() => setSelectedAuction(null)}
                />


            ) : (
                <>
                    {/* Фильтры */}
                    <div style={{ marginBottom: '12px' }}>
                        <select
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '10px',
                                borderRadius: '8px',
                                border: '1px solid #ccc',
                                marginBottom: '8px',
                                fontSize: '14px',
                            }}
                        >
                            <option value="all">Всі міста</option>
                            {[...new Set(AUCTIONS.map(a => a.city))].map(c => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>

                        <select
                            value={sort}
                            onChange={(e) => setSort(e.target.value as 'time' | 'bid')}
                            style={{
                                width: '100%',
                                padding: '10px',
                                borderRadius: '8px',
                                border: '1px solid #ccc',
                                fontSize: '14px',
                            }}
                        >
                            <option value="time">За часом завершення</option>
                            <option value="bid">За ставкою</option>
                        </select>
                    </div>

                    {/* Список */}
                    {filteredAuctions.length === 0 ? (
                        <div
                            style={{
                                padding: '16px',
                                background: '#fff',
                                borderRadius: '12px',
                                textAlign: 'center',
                                color: '#777',
                            }}
                        >
                            Аукціони не знайдено
                        </div>
                    ) : (
                        filteredAuctions.map(item => (
                            <div
                                key={item.id}
                                onClick={() => setSelectedAuction(item.id)}
                                style={{ cursor: 'pointer' }}
                            >
                                <AuctionCard
                                    title={item.title}
                                    city={item.city}
                                    currentBid={item.currentBid}
                                    timeLeft={getTimeLeft(item.endAt)}
                                />
                            </div>
                        ))
                    )}
                </>
            )}
        </div>
    )
}

export default AuctionPage
