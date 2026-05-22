import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { verifyPayPalPayment } from "../api/payments"
import { PRICES } from "../config/prices"
import { formatPricePLN } from "../utils/formatPricePLN"
import type { translations } from "../app/i18n"

import { PayPalButtons } from "@paypal/react-paypal-js"
import { useSeo, BASE_URL } from '../utils/seo'
import { addDoc, collection } from "firebase/firestore"
import { getLocalUser } from "../data/localUser"
import AuthorCard from "../components/AuthorCard"
import { getAdImages } from "../utils/getAdImages";
import { buildAdPath, extractIdFromSlug } from "../utils/slug";
import { db } from '../app/firebase'
import type { Ad } from '../types/ad'
type Props = {
    t: (typeof translations)[keyof typeof translations]
}
function AdDetailsPage({ t }: Props) {
    const a = t.adDetails

    const { id: slugOrId } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const [isImageOpen, setIsImageOpen] = useState(false)
    const currentUser = getLocalUser()


    const [ad, setAd] = useState<Ad | null>(null)
    const [loading, setLoading] = useState(true)
    const [isReportOpen, setIsReportOpen] = useState(false)
    const [reportText, setReportText] = useState("")
    const [reportSending, setReportSending] = useState(false)
    const [activeIndex, setActiveIndex] = useState(0)
    const images = ad ? getAdImages(ad) : []
    const mainImage = images[activeIndex]

    const [payAction, setPayAction] = useState<
        null | "bump" | "top3" | "top6" | "gold"
    >(null)


    // async function handleHighlightGold() {
    //     if (!ad) return
    //     if (!isOwner) return
    //
    //     try {
    //         const until = Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 дней
    //
    //         await updateDoc(doc(db, "ads", ad.id), {
    //             highlightType: "gold",
    //             highlightUntil: until,
    //         })
    //
    //         // обновляем UI локально, чтобы сразу отобразилось
    //         setAd(prev => (prev ? { ...prev, highlightType: "gold", highlightUntil: until } : prev))
    //     } catch (e) {
    //         console.error(e)
    //         alert("Помилка при виділенні оголошення")
    //     }
    // }
    //
    //
    // async function handleBumpAd() {
    //     if (!ad) return
    //     if (!isOwner) return
    //
    //     try {
    //         const now = Date.now()
    //
    //         await updateDoc(doc(db, "ads", ad.id), {
    //             bumpAt: now,
    //         })
    //
    //         // обновляем локально
    //         setAd(prev => (prev ? { ...prev, bumpAt: now } : prev))
    //     } catch (e) {
    //         console.error(e)
    //         alert("Помилка при піднятті оголошення")
    //     }
    // }
    // async function handleTopRequest(type: "top3" | "top6") {
    //     if (!ad) return
    //     if (!isOwner) return
    //
    //     // Если уже активен TOP или уже в очереди — не даём нажать повторно
    //     const now = Date.now()
    //     const pinActive =
    //         !!ad.pinType && !!ad.pinnedUntil && ad.pinnedUntil > now
    //     const inQueue =
    //         !!ad.pinType &&
    //         !!ad.pinQueueAt &&
    //         (!ad.pinnedUntil || ad.pinnedUntil <= now)
    //
    //     if (pinActive || inQueue) {
    //         alert("Це оголошення вже має TOP або стоїть у черзі")
    //         return
    //     }
    //
    //     try {
    //         const queueAt = Date.now()
    //
    //         await updateDoc(doc(db, "ads", ad.id), {
    //             pinType: type,
    //             pinQueueAt: queueAt,
    //             // pinnedUntil не трогаем — оно выставится функцией rotatePinnedAds
    //         })
    //
    //         // обновляем UI локально
    //         setAd(prev => (prev ? { ...prev, pinType: type, pinQueueAt: queueAt } : prev))
    //     } catch (e) {
    //         console.error(e)
    //         alert("Помилка при постановці у чергу TOP")
    //     }
    // }
    //
    // async function handleTop3() {
    //     return handleTopRequest("top3")
    // }
    //
    // async function handleTop6() {
    //     return handleTopRequest("top6")
    // }



    useEffect(() => {
        async function loadAd() {
            const parsedId = extractIdFromSlug(slugOrId)
            if (!parsedId) return

            const ref = doc(db, 'ads', parsedId)
            const snap = await getDoc(ref)


            if (snap.exists()) {
                setAd({
                    id: parsedId, // ✅ string из Firestore
                    ...(snap.data() as Omit<Ad, 'id'>),
                })
                setActiveIndex(0)

            } else {
                setAd(null)
            }


            setLoading(false)
        }

        loadAd()
    }, [slugOrId])

    useEffect(() => {
        if (!ad || !slugOrId) return
        const canonicalPath = buildAdPath(ad.title, ad.city, ad.id)
        if (`/ad/${slugOrId}` !== canonicalPath) {
            navigate(canonicalPath, { replace: true })
        }
    }, [ad, slugOrId, navigate])
    const lang = (localStorage.getItem('lang') === 'pl' ? 'pl' : 'uk') as 'pl' | 'uk'
    const seoTitle = ad
        ? (lang === 'pl' ? `${ad.title} ${ad.city} | Xoven` : `Купити ${ad.title} ${ad.city} | Xoven`)
        : (lang === 'pl' ? 'Ogłoszenie | Xoven' : 'Оголошення | Xoven')
    const seoDescription = ad
        ? (lang === 'pl'
            ? `Kupuj i sprzedawaj lokalnie w Polsce. Zobacz ogłoszenie: ${ad.title} w ${ad.city}.`
            : `Купуй та продавай у Польщі. Переглянь оголошення: ${ad.title} у ${ad.city}.`)
        : (lang === 'pl' ? 'Darmowe ogłoszenia w Polsce.' : 'Безкоштовні оголошення в Польщі.')

    useSeo({
        title: seoTitle,
        description: seoDescription,
        path: `/ad/${slugOrId ?? ''}`,
        lang,
        alternates: [
            { hreflang: 'pl-PL', href: `${BASE_URL}/pl/ogloszenia` },
            { hreflang: 'uk-UA', href: `${BASE_URL}/uk/ogoloshennya` },
            { hreflang: 'x-default', href: `${BASE_URL}/pl/ogloszenia` },
        ],
        jsonLd: ad ? {
            '@context': 'https://schema.org',
            '@type': 'Offer',
            name: ad.title,
            description: ad.description,
            price: ad.price ?? 0,
            priceCurrency: 'PLN',
            areaServed: 'PL',
        } : undefined,
    })

    if (loading) {
        return <div className="card">{a.loading}</div>
    }

    if (!ad) {
        return <div className="card">{a.notFound}</div>
    }

    const isOwner = !!currentUser && String(currentUser.id) === String(ad.userId)
    const now = Date.now()

    const isHighlightActive =
        !!ad.highlightUntil && ad.highlightUntil > now
    const isPinActive =
        !!ad.pinType &&
        !!ad.pinnedUntil &&
        ad.pinnedUntil > now

    const isInQueue =
        !!ad.pinType &&
        !!ad.pinQueueAt &&
        (!ad.pinnedUntil || ad.pinnedUntil <= now)



    return (
        <div className="stack12">
            <button
                onClick={() => navigate(-1)}
                style={{
                    background: 'none',
                    border: 'none',
                    color: '#1976d2',
                    padding: 0,
                    fontSize: '14px',
                    cursor: 'pointer',
                }}
            >
                ← {a.back}

            </button>

            <div className="card stack12">
                <h2 className="h2">{ad.title}</h2>

                <div style={{ fontSize: '14px', color: '#6b7280' }}>
                    {ad.city} · {ad.voivodeship}
                </div>

                {ad.price && (
                    <div className="price">{formatPricePLN(ad.price)}</div>

                )}
                {/* Продавець (MVP-заглушка) */}
                <AuthorCard
                    userId={ad.userId}
                    isOwner={isOwner}
                    onReport={() => setIsReportOpen(true)}
                />
                {isOwner && (
                    <div className="ad-owner-panel card stack12">
                        <div style={{fontWeight: 700}}>{a.ownerPanel.title}</div>

                        <button
                            type="button"
                            className="btn-primary"
                            onClick={() => navigate(`/edit/${ad.id}`)}
                        >
                            ✏️ {a.actions.edit}

                        </button>

                        {/* Статус выделения */}
                        {isHighlightActive && ad.highlightUntil && (
                            <div style={{fontSize: 13, color: "#6b7280"}}>
                                ✨ Виділення активне до {new Date(ad.highlightUntil).toLocaleDateString("uk-UA")}
                            </div>
                        )}
                        {isPinActive && ad.pinnedUntil && (
                            <div style={{fontSize: 13, color: "#6b7280"}}>
                                📌 {ad.pinType === "top3" ? "TOP 3" : "TOP 6"} активний до{" "}
                                {new Date(ad.pinnedUntil).toLocaleDateString("uk-UA")}
                            </div>
                        )}

                        {isInQueue && ad.pinQueueAt && (
                            <div style={{fontSize: 13, color: "#6b7280"}}>
                                🕒 В черзі на {ad.pinType === "top3" ? "TOP 3" : "TOP 6"} з{" "}
                                {new Date(ad.pinQueueAt).toLocaleDateString("uk-UA")}
                            </div>
                        )}

                        <div className="ad-manage-actions" style={{display: "flex", gap: 8, flexWrap: "wrap"}}>
                            <button
                                type="button"
                                className="btn-secondary ad-action-bump"
                                onClick={() => setPayAction("bump")}

                            >
                                🚀 {a.actions.bump}

                            </button>
                            <button
                                type="button"
                                className="btn-secondary ad-action-top3"
                                onClick={() => setPayAction("top3")}
                                disabled={isPinActive || isInQueue}
                            >
                                🔥 TOP 3
                            </button>


                            <button
                                type="button"
                                className="btn-secondary ad-action-top6"
                                onClick={() => setPayAction("top6")}

                                disabled={isPinActive || isInQueue}
                                title={isPinActive || isInQueue ? "TOP вже активний або оголошення в черзі" : "Поставити в чергу TOP 6"}
                            >
                                ⭐ TOP 6
                            </button>

                            <button
                                type="button"
                                className="btn-secondary ad-action-highlight"
                                onClick={() => setPayAction("gold")}

                                disabled={isHighlightActive}
                                title={isHighlightActive ? "Виділення вже активне" : "Виділити оголошення на 7 днів"}
                            >
                                ✨ Виділити (GOLD)
                            </button>
                        </div>
                    </div>
                )}
                {payAction && (
                    <div className="card stack12">
                        <strong>{a.payment.title}</strong>


                        <div style={{fontSize: 14}}>
                            {payAction === "bump" && `🚀 Підняти оголошення (${PRICES.ad.bump} PLN)`}
                            {payAction === "top3" && `🔥 TOP 3 (${PRICES.ad.top3} PLN)`}
                            {payAction === "top6" && `⭐ TOP 6 (${PRICES.ad.top6} PLN)`}
                            {payAction === "gold" && `✨ Виділити GOLD (${PRICES.ad.gold} PLN)`}
                        </div>


                        <PayPalButtons
                            style={{ layout: "vertical" }}
                            createOrder={(_, actions) => {
                                return actions.order.create({
                                    intent: "CAPTURE",
                                    purchase_units: [
                                        {
                                            amount: {
                                                value: PRICES.ad[payAction],
                                                currency_code: "PLN",
                                            },
                                        },
                                    ],
                                })
                            }}


                            onApprove={async (_, actions) => {
                                if (!actions.order || !ad) return

                                const details = await actions.order.capture()

                                await verifyPayPalPayment({
                                    orderId: details.id!,
                                    targetType: "ad",
                                    targetId: ad.id,
                                    promotionType:
                                        payAction === "gold" ? "gold" : payAction,
                                })

                                alert(a.payment.success)

                                setPayAction(null)
                            }}

                            onError={() => {
                                alert(a.payment.error)

                                setPayAction(null)
                            }}
                        />
                    </div>
                )}


                {/* Фото */}
                <div
                    style={{
                        height: '220px',
                        background: '#e5e7eb',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#6b7280',
                        fontSize: '14px',
                        overflow: 'hidden',
                    }}
                >
                    {mainImage ? (
                        <img
                            src={mainImage}
                            alt={ad.title}
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
                        a.noImage

                    )}
                </div>
                {/* Мініатюри */}
                {images.length > 1 && (
                    <div
                        style={{
                            display: 'flex',
                            gap: '8px',
                            marginTop: '8px',
                            overflowX: 'auto',
                        }}
                    >
                        {images.map((img, i) => (
                            <img
                                key={img}
                                src={img}
                                alt={`thumb-${i}`}
                                onClick={() => setActiveIndex(i)}
                                style={{
                                    width: '56px',
                                    height: '56px',
                                    objectFit: 'cover',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    border: i === activeIndex ? '2px solid #1976d2' : '2px solid transparent',
                                    opacity: i === activeIndex ? 1 : 0.7,
                                }}
                            />
                        ))}
                    </div>
                )}


                <div style={{fontSize: '15px', lineHeight: 1.6}}>
                    {ad.description ?? a.noDescription}

                </div>
            </div>
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
                        alt={ad.title}
                        style={{
                            maxWidth: '90%',
                            maxHeight: '90%',
                            objectFit: 'contain',
                            borderRadius: '12px',
                        }}
                    />
                </div>
            )}

            {isReportOpen && ad && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.6)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 1000,
                    }}
                >
                    <div
                        className="card stack12"
                        style={{ maxWidth: "420px", width: "100%" }}
                    >
                        <h3 className="h3">{a.report.title}</h3>


                        <textarea
                            className="input"
                            placeholder={a.report.placeholder}

                            value={reportText}
                            onChange={(e) => setReportText(e.target.value)}
                            rows={4}
                        />

                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                            <button
                                className="btn-secondary"
                                type="button"
                                onClick={() => {
                                    setIsReportOpen(false)
                                    setReportText("")
                                }}
                            >
                                {a.report.cancel}

                            </button>

                            <button
                                className="btn-primary"
                                disabled={reportSending || !reportText.trim()}
                                onClick={async () => {
                                    try {
                                        setReportSending(true)

                                        const user = getLocalUser()

                                        await addDoc(collection(db, "reports"), {
                                            adId: ad.id,
                                            adTitle: ad.title,
                                            reportedUserId: ad.userId,
                                            reporterUserId: user?.id,
                                            message: reportText.trim(),
                                            createdAt: Date.now(),
                                            status: "new",
                                        })

                                        alert(a.report.sent)

                                        setIsReportOpen(false)
                                        setReportText("")} catch (e) {
                                        console.error(e)
                                        alert(a.report.error)

                                    } finally {
                                        setReportSending(false)
                                    }
                                }}
                            >
                                {a.report.submit}

                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}

export default AdDetailsPage
