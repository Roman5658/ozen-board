import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from '../app/firebase'
import { collection, getDocs, query, where } from 'firebase/firestore'
import AdCard from '../components/AdCard'
import type { Ad } from '../types/ad'
import { Link } from 'react-router-dom'
import type { Auction } from '../types/auction'
import AuctionCard from '../components/AuctionCard'
import { getLocalUser } from '../data/localUser'
import { translations, DEFAULT_LANG } from '../app/i18n'
import type { Lang } from '../app/i18n'
import { buildAdPath, buildAuctionPath } from '../utils/slug'
import type { UserReview } from '../types/userReview'
import { getOrCreateChat } from '../data/chats'



type PublicUser = {
    nickname: string
    createdAt?: number
    karma: number
    phone?: string | null
    telegram?: string | null
}


function UserPage() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const location = useLocation()
    const [user, setUser] = useState<PublicUser | null>(null)
    const [loading, setLoading] = useState(true)
    const [ads, setAds] = useState<Ad[]>([])
    const [adsLoading, setAdsLoading] = useState(false)
    const [auctions, setAuctions] = useState<Auction[]>([])

    const [auctionsLoading, setAuctionsLoading] = useState(false)
    const currentUser = getLocalUser()
    const [reviews, setReviews] = useState<UserReview[]>([])
    const isLoggedIn = !!currentUser
    const isOwnProfile = currentUser?.id === id
    const lang = (localStorage.getItem('lang') as Lang) || DEFAULT_LANG
    const t = translations[lang]
    const fromAdPath = typeof (location.state as { fromAdPath?: unknown } | null)?.fromAdPath === 'string'
        ? (location.state as { fromAdPath: string }).fromAdPath
        : null

    async function openChat() {
        if (!currentUser || !id) return

        try {
            const chatId = await getOrCreateChat(currentUser.id, id)
            navigate(`/chat/${chatId}`)
        } catch (error) {
            console.error('[user profile] failed to open chat', error)
            alert(t.userPage.chatError)
        }
    }




    useEffect(() => {
        if (!id) {
            setLoading(false)
            setUser(null)
            return
        }

        const userId = id // 👈 теперь TS знает, что это string

        async function loadUser() {
            try {
                const ref = doc(db, 'users', userId)
                const snap = await getDoc(ref)

                if (snap.exists()) {
                    const data = snap.data()

                    setUser({
                        nickname: data.nickname ?? t.common.user,
                        createdAt: data.createdAt,
                        karma: typeof data.karma === 'number' ? data.karma : 0,
                        phone: (typeof data.phone === 'string' && data.phone.trim()) ? data.phone.trim() : null,
                        telegram: (typeof data.telegram === 'string' && data.telegram.trim()) ? data.telegram.trim() : null,
                    })

                } else {
                    setUser(null)
                }
            } catch (error) {
                console.error('[user profile] failed to load user', error)
                setUser(null)
            } finally {
                setLoading(false)
            }
        }

        loadUser()
    }, [id])
    useEffect(() => {
        if (!id) return

        async function loadUserAds() {
            setAdsLoading(true)

            try {
                const q = query(
                    collection(db, 'ads'),
                    where('userId', '==', id)
                )

                const snap = await getDocs(q)

                const data: Ad[] = snap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as Omit<Ad, 'id'>),
                }))

                setAds(data.filter((ad) => (ad.status ?? 'active') === 'active'))
            } catch (error) {
                console.error('[user profile] failed to load ads', error)
                setAds([])
            } finally {
                setAdsLoading(false)
            }
        }

        loadUserAds()
    }, [id])

    useEffect(() => {
        if (!id) return

        async function loadUserAuctions() {
            setAuctionsLoading(true)

            try {
                const q = query(
                    collection(db, 'auctions'),
                    where('ownerId', '==', id)
                )

                const snap = await getDocs(q)

                const data: Auction[] = snap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as Omit<Auction, 'id'>),
                }))

                setAuctions(data.filter((auction) => (auction.status ?? 'active') === 'active'))
            } catch (error) {
                console.error('[user profile] failed to load auctions', error)
                setAuctions([])
            } finally {
                setAuctionsLoading(false)
            }
        }

        loadUserAuctions()
    }, [id])

    useEffect(() => {
        if (!id) return
            ;(async () => {
            try {
                const snap = await getDocs(query(collection(db, 'userReviews'), where('targetUserId', '==', id)))
                setReviews(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<UserReview, 'id'>) })))
            } catch (error) {
                console.error('[user profile] failed to load reviews', error)
                setReviews([])
            }
        })()
    }, [id, t.common.user])

    if (loading) {
        return <div className="card">{t.userPage.loading}</div>


    }

    if (!user) {
        return <div className="card">{t.userPage.notFound}</div>
    }


    return (
        <div>
            <h2>{t.userPage.title}</h2>
            {fromAdPath && (
                <button
                    type="button"
                    className="btn-secondary"
                    style={{ marginBottom: 12 }}
                    onClick={() => navigate(fromAdPath)}
                >
                    ← {t.userPage.backToAd}
                </button>
            )}

            <div style={{marginTop: 12}}>
                <div><b>{t.userPage.nickname}:</b>
                    {user.nickname}</div>

                <div style={{marginTop: 6}}>
                    <b>{t.userPage.reviews}:</b> {reviews.length} · <b>{t.userPage.reputation}:</b> {reviews.reduce((sum, r) => sum + (r.karmaValue ?? 0), 0)}
                </div>
                {isLoggedIn && !isOwnProfile && (
                    <button
                        className="btn-primary"
                        style={{marginTop: 12}}
                        onClick={openChat}
                    >
                        {t.userPage.write}

                    </button>
                )}

                {user.createdAt && (
                    <div style={{fontSize: 13, color: '#666', marginTop: 6}}>
                        {t.userPage.joined}: {new Date(user.createdAt).toLocaleString()}

                    </div>
                )}

                {(user.phone || user.telegram) ? (
                    <div style={{marginTop: 12}}>
                        <div style={{fontWeight: 600, marginBottom: 6}}>{t.userPage.contacts}</div>

                        {user.phone && (
                            <div>
                                {t.userPage.phone}: <a href={`tel:${user.phone}`}>{user.phone}</a>
                            </div>

                        )}

                        {user.telegram && (
                            <div style={{marginTop: 4}}>
                                Telegram:{' '}
                                <a
                                    href={`https://t.me/${user.telegram.replace('@', '')}`}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    @{user.telegram.replace('@', '')}
                                </a>
                            </div>
                        )}
                    </div>
                ) : (
                    <div style={{marginTop: 12, fontSize: 13, color: '#666'}}>
                        {t.userPage.noContacts}

                    </div>
                )}
            </div>
            <hr style={{margin: '20px 0'}}/>
            <h3>{t.userPage.reviews}</h3>
            {reviews.length === 0 ? <div style={{fontSize: 14, color: '#666'}}>{t.userPage.noReviews}</div> :
                <div className='stack12'>{reviews.map(r => <div key={r.id} className='card'>
                    <div><b>{r.authorUserName ?? r.authorUserId}</b> · {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                    <div>{r.adTitle}</div>
                    <div>{t.userPage.reviewKarma}: {r.karmaValue > 0 ? '+1' : '-1'}</div>
                    <div>{r.comment}</div>
                </div>)}</div>}

            <hr style={{margin: '20px 0'}}/>

            <h3>{t.userPage.adsTitle}</h3>


            {adsLoading ? (
                <div style={{fontSize: 14, color: '#666'}}>
                    {t.userPage.adsLoading}

                </div>
            ) : ads.length === 0 ? (
                <div style={{fontSize: 14, color: '#666'}}>
                    {t.userPage.noAds}

                </div>
            ) : (
                <div className="ads-grid">
                    {ads.map(ad => (
                        <Link
                            key={ad.id}
                            to={buildAdPath(ad.title, ad.city, ad.id)}
                            style={{textDecoration: 'none', color: 'inherit'}}
                        >
                            <AdCard ad={ad} userNickname={user.nickname} labels={t.adCard} />
                        </Link>
                    ))}
                </div>
            )}



            <hr style={{margin: '20px 0'}}/>
            <h3>{t.userPage.auctionsTitle}</h3>


            {auctionsLoading ? (
                <div style={{fontSize: 14, color: '#666'}}>
                    {t.userPage.auctionsLoading}
                </div>
            ) : auctions.length === 0 ? (
                <div style={{fontSize: 14, color: '#666'}}>
                    {t.userPage.noAuctions}
                </div>
            ) : (
                <div className="stack12">
                    {auctions.map(auction => {
                        const isEnded = auction.endsAt <= Date.now()

                        return (
                            <Link
                                key={auction.id}
                                to={buildAuctionPath(auction.title, auction.city, auction.id)}
                                style={{textDecoration: 'none', color: 'inherit'}}
                            >
                                <AuctionCard
                                    t={t}
                                    title={auction.title}
                                    city={auction.city}
                                    currentBid={auction.currentBid}
                                    timeLeft={
                                        isEnded
                                            ? t.userPage.auctionEnded
                                            : `${Math.ceil((auction.endsAt - Date.now()) / 60000)} ${t.userPage.minutesShort}`

                                    }
                                    image={auction.images?.[0]}
                                    ownerName={auction.ownerNickname?.trim() || auction.ownerName?.trim() || user.nickname}
                                    isEnded={isEnded}
                                />
                            </Link>
                        )
                    })}
                </div>
            )}


        </div>
    )
}

export default UserPage
