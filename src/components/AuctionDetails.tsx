import { useState } from 'react'
import { addDoc, collection } from 'firebase/firestore'
import { placeBid } from '../data/placeBid'
import { useNavigate } from 'react-router-dom'
import AuthorCard from "../components/AuthorCard"
import type { translations } from "../app/i18n"
import { PRICES } from "../config/prices"
import { verifyPayPalPayment } from "../api/payments"
import PayPalCheckoutButton from "./PayPalCheckoutButton"
import { auth, db } from "../app/firebase"

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

type AuctionPromotionAction = "top-auction" | "featured" | "highlight-gold"

type Props = {
    t: (typeof translations)[keyof typeof translations]

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
    promotionType: "none" | AuctionPromotionAction
    promotionUntil?: number | null
    promotionQueueAt?: number | null
    onBack: () => void
    currentUserId: string | null
    currentUserName: string | null
    onBidSuccess: () => void
    onPromotionSuccess: () => void
}


function AuctionDetails({
                            t,
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
                            promotionType,
                            promotionUntil,
                            promotionQueueAt,
                            onBack,
                            currentUserId,
                            currentUserName,
                            onBidSuccess,
                            onPromotionSuccess,
                        }: Props) {
    const [amount, setAmount] = useState('')
    const [error, setError] = useState('')
    const [isReportOpen, setIsReportOpen] = useState(false)
    const [reportText, setReportText] = useState('')
    const [reportSent, setReportSent] = useState(false)
    const [reportError, setReportError] = useState('')
    const [reportSending, setReportSending] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [payAction, setPayAction] = useState<AuctionPromotionAction | null>(null)
    const [isPromoting, setIsPromoting] = useState(false)
    const navigate = useNavigate()
    const [activeIndex, setActiveIndex] = useState(0)
    const [isImageOpen, setIsImageOpen] = useState(false)
    const mainImage = images?.[activeIndex]

    const isEnded = timeLeft === t.auctionDetails.ended
    const hasActivePromotion =
        !!promotionUntil &&
        promotionUntil > Date.now()
    const hasQueuedPromotion =
        !!promotionQueueAt &&
        (!promotionUntil || promotionUntil <= Date.now())

    const isAuthor =
        !!(
            isAuthenticated &&
            currentUserId &&
            seller?.id &&
            currentUserId === seller.id
        )


    async function submitReport() {
        const text = reportText.trim()
        if (!text) return

        const authUser = auth.currentUser
        if (!authUser) {
            setReportError(t.auctionDetails.report.authRequired)
            return
        }

        setReportSending(true)
        setReportError('')

        try {
            await addDoc(collection(db, "reports"), {
                targetType: "auction",
                targetId: auctionId,
                reporterId: authUser.uid,
                reason: "user-report",
                description: text,
                status: "new",
                createdAt: Date.now(),
                reviewedAt: null,
                reviewedBy: null,
            })

            setReportSent(true)
            setIsReportOpen(false)
            setReportText('')
        } catch (e) {
            console.error(e)
            setReportError(t.auctionDetails.report.error)
        } finally {
            setReportSending(false)
        }
    }

    async function placeBidHandler() {
        const authUser = auth.currentUser
        const matchesAuthUser =
            !!authUser &&
            !!currentUserId &&
            (
                authUser.uid === currentUserId ||
                authUser.email?.toLowerCase() === currentUserId.toLowerCase()
            )

        if (!matchesAuthUser) {
            setError(t.auctionDetails.authRequired)
            return
        }

        if (!seller) return

        const value = Number(amount)

        if (!value || value <= currentBid) {
            setError(t.auctionDetails.errors.bidTooLow)

            return
        }

        setIsSubmitting(true)
        setError('')

        try {
            await placeBid({
                auctionId,
                userId: currentUserId,
                userName: currentUserName?.trim() || t.common.user,
                amount: value,
            })

            setAmount('')
            onBidSuccess()

        } catch (e) {
            if (e instanceof Error) {
                setError(e.message)
            } else {
                setError(t.auctionDetails.errors.bidFailed)

            }
        }
        finally {
            setIsSubmitting(false)
        }
    }

    function getPromotionLabel(action: AuctionPromotionAction): string {
        if (action === "top-auction") return "TOP"
        if (action === "featured") return "Featured"
        return "GOLD"
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
                ← {t.auctionDetails.back}
            </button>

            <h2>{title}</h2>

            {/* Фото аукціону */}
            {images && images.length > 0 && (
                <>
                    {/* Головне фото */}
                    <div
                        style={{
                            height: 220,
                            background: '#e5e7eb',
                            borderRadius: 12,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            margin: '12px 0',
                        }}
                    >
                        {mainImage ? (
                            <img
                                src={mainImage}
                                alt={title}
                                onClick={() => setIsImageOpen(true)}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'contain',
                                    background: '#f3f4f6',
                                    cursor: 'zoom-in',
                                }}
                            />
                        ) : (
                            t.auctionDetails.noImage
                        )}
                    </div>

                    {/* Мініатюри */}
                    {images.length > 1 && (
                        <div
                            style={{
                                display: 'flex',
                                gap: 8,
                                overflowX: 'auto',
                                marginBottom: 12,
                            }}
                        >
                            {images.map((img, idx) => (
                                <img
                                    key={idx}
                                    src={img}
                                    alt=""
                                    onClick={() => setActiveIndex(idx)}
                                    style={{
                                        width: 56,
                                        height: 56,
                                        objectFit: 'cover',
                                        borderRadius: 6,
                                        cursor: 'pointer',
                                        border:
                                            idx === activeIndex
                                                ? '2px solid #1976d2'
                                                : '2px solid transparent',
                                        opacity: idx === activeIndex ? 1 : 0.7,
                                        flexShrink: 0,
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}
            {isImageOpen && mainImage && (
                <div
                    onClick={() => setIsImageOpen(false)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.8)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        cursor: 'zoom-out',
                    }}
                >
                    <img
                        src={mainImage}
                        alt={title}
                        style={{
                            maxWidth: '90%',
                            maxHeight: '90%',
                            objectFit: 'contain',
                            borderRadius: 12,
                        }}
                    />
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

            {seller && (
                <AuthorCard
                    userId={seller.id}
                    adId={auctionId}
                    adTitle={title}
                    onReport={() => setIsReportOpen(true)}
                    t={t}
                />
            )}

            {isAuthor && !isEnded && (
                <div
                    style={{
                        marginTop: 12,
                        padding: 12,
                        borderRadius: 10,
                        background: "#eef2ff",
                    }}
                >
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>
                        {t.auctionDetails.ownerPanel.title}
                    </div>

                    {bids.length === 0 && (
                    <button
                        type="button"
                        onClick={() => navigate(`/edit-auction/${auctionId}`)}
                        style={{
                            width: "100%",
                            padding: 12,
                            borderRadius: 10,
                            border: "none",
                            background: "#1976d2",
                            color: "#fff",
                            fontWeight: 600,
                            cursor: "pointer",
                        }}
                    >
                        ✏️ {t.auctionDetails.actions.edit}
                    </button>
                    )}

                    {promotionType !== "none" && (hasActivePromotion || hasQueuedPromotion) && (
                        <div style={{fontSize: 13, color: "#4b5563", marginTop: 8}}>
                            {hasActivePromotion
                                ? `Promotion active: ${getPromotionLabel(promotionType)}`
                                : `Promotion queued: ${getPromotionLabel(promotionType)}`}
                        </div>
                    )}

                    <div style={{display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8}}>
                        <button
                            type="button"
                            className="btn-secondary"
                            disabled={hasActivePromotion || hasQueuedPromotion || isPromoting}
                            onClick={() => setPayAction("top-auction")}
                        >
                            TOP ({PRICES.auction["top-auction"]} PLN)
                        </button>
                        <button
                            type="button"
                            className="btn-secondary"
                            disabled={hasActivePromotion || hasQueuedPromotion || isPromoting}
                            onClick={() => setPayAction("featured")}
                        >
                            Featured ({PRICES.auction.featured} PLN)
                        </button>
                        <button
                            type="button"
                            className="btn-secondary"
                            disabled={hasActivePromotion || hasQueuedPromotion || isPromoting}
                            onClick={() => setPayAction("highlight-gold")}
                        >
                            GOLD ({PRICES.auction["highlight-gold"]} PLN)
                        </button>
                    </div>

                    {payAction && (
                        <div className="card stack12" style={{marginTop: 12}}>
                            <strong>{t.addAuction.payment.title}</strong>
                            <div style={{fontSize: 14}}>
                                {getPromotionLabel(payAction)} ({PRICES.auction[payAction]} PLN)
                            </div>
                            <div style={{fontSize: 13, color: "#6b7280"}}>
                                {t.addAuction.payment.queueInfo}
                            </div>
                            <PayPalCheckoutButton
                                amountPLN={PRICES.auction[payAction]}
                                description="Ozen Board - auction promotion"
                                disabled={isPromoting}
                                onApprove={async (orderId) => {
                                    setIsPromoting(true)
                                    await verifyPayPalPayment({
                                        orderId,
                                        targetType: "auction",
                                        targetId: auctionId,
                                        promotionType: payAction,
                                    })

                                    setIsPromoting(false)
                                    setPayAction(null)
                                    onPromotionSuccess()
                                    alert("Promotion activated")
                                }}
                                onError={() => {
                                    setIsPromoting(false)
                                    setPayAction(null)
                                    alert("Promotion payment error")
                                }}
                            />
                        </div>
                    )}
                </div>
            )}



            {reportSent && (
                    <div style={{marginTop: 10, fontSize: 13, color: '#2e7d32'}}>
                        {t.auctionDetails.report.sent}
                    </div>
                )}
            {reportError && (
                <div style={{marginTop: 10, fontSize: 13, color: '#b91c1c'}}>
                    {reportError}
                </div>
            )}

                {isReportOpen && (
                    <div style={{marginTop: 10}}>
                        <textarea
                            value={reportText}
                            onChange={e => setReportText(e.target.value)}
                            rows={4}
                            placeholder={t.auctionDetails.report.placeholder}
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
                            disabled={reportSending || !reportText.trim()}
                            style={{
                                width: '100%',
                                padding: 12,
                                borderRadius: 10,
                                border: 'none',
                                background: !reportSending && reportText.trim() ? '#111827' : '#9ca3af',
                                color: '#fff',
                                fontWeight: 700,
                                cursor: !reportSending && reportText.trim() ? 'pointer' : 'not-allowed',
                            }}
                        >
                            {t.auctionDetails.report.submit}
                        </button>
                    </div>
                )}


            <div style={{fontWeight: 600, marginBottom: 4}}>
                {t.auctionDetails.currentBid}: {currentBid} zł
            </div>

            <div style={{color: '#d32f2f', marginBottom: 12}}>
                {t.auctionDetails.timeLeft}: {timeLeft}
            </div>

            {!isEnded && (
                isAuthenticated ? (
                    isAuthor ? (
                        <div style={{padding: 12, background: '#eef2ff', borderRadius: 10}}>
                            {t.auctionDetails.authorCannotBid}

                        </div>
                    ) : (
                        <div>
                            <input
                                type="number"
                                value={amount}
                                onChange={e => setAmount(e.target.value)}
                                placeholder={t.auctionDetails.bid.placeholder}

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
                                {isSubmitting
                                    ? t.auctionDetails.bid.loading
                                    : t.auctionDetails.bid.submit
                                }

                            </button>

                        </div>
                    )
                ) : (
                    <div style={{padding: 12, background: '#fff3e0', borderRadius: 10}}>
                        {t.auctionDetails.authRequired}
                    </div>
                )
            )}

            <h3 style={{marginTop: 16}}>{t.auctionDetails.bids.title}</h3>

            {bids.length === 0 ? (
                <div style={{fontSize: 14, color: '#777' }}>
                    {t.auctionDetails.bids.empty}
                </div>
            ) : (
                bids.map(bid => (
                    <div key={bid.id} style={{ fontSize: 14 }}>
                        <span
                            style={{ color: '#1976d2', cursor: 'pointer', fontWeight: 600 }}
                            onClick={() => navigate(`/user/${bid.userId}`)}
                        >
    {bid.nickname ?? bid.userName ?? t.common.user}

</span>
                        : {bid.amount} zł

                    </div>
                ))
            )}
        </div>
    )
}

export default AuctionDetails
