import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import { collection, addDoc } from "firebase/firestore"
import { PRICES } from "../config/prices"
import type { translations } from "../app/i18n"
import { db, storage } from "../app/firebase"
import { getLocalUser } from "../data/localUser"
import { assertUserNotBlocked, isAccountRestrictedError } from "../data/users"
import { CITIES_BY_VOIVODESHIP } from "../data/cities"
import { checkAuctionPromotionAvailability } from "../data/auctionAvailability"
import PayPalCheckoutButton from "../components/PayPalCheckoutButton"


import { verifyPayPalPayment } from "../api/payments"

type Category = "sell" | "buy" | "service" | "rent"
type VoivodeshipKey = keyof typeof CITIES_BY_VOIVODESHIP
type Props = {
    t: (typeof translations)[keyof typeof translations]
}
type AuctionPromotion =
    | "none"
    | "top-auction"
    | "featured"
    | "highlight-gold"

const DAY = 24 * 60 * 60 * 1000

function AddAuctionPage({ t }: Props) {
    const navigate = useNavigate()

    // ===== STATE =====
    const [title, setTitle] = useState("")
    const [description, setDescription] = useState("")
    const [category, setCategory] = useState<Category | "">("")
    const [voivodeship, setVoivodeship] = useState("")
    const [city, setCity] = useState("")
    const [startPrice, setStartPrice] = useState("")
    const [imageFiles, setImageFiles] = useState<File[]>([])
    const [endsAtDate, setEndsAtDate] = useState("")

    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [promotion, setPromotion] = useState<AuctionPromotion>("none")
    const [isPaying, setIsPaying] = useState(false)
    const [paymentCompleted, setPaymentCompleted] = useState(false)
    const [paypalOrderId, setPaypalOrderId] = useState<string | null>(null)
    const paymentSuccessMessage = "Оплата успешно подтверждена. Теперь нажмите «Создать аукцион», чтобы завершить публикацию."

    const [promotionInfo, setPromotionInfo] = useState<{
        text: string
        isQueue: boolean
    } | null>(null)

    // ===== AUTH =====
    const isPaidPromotion = promotion !== "none"

// 👇 ХУКИ ВСЕГДА СНАЧАЛА
    const pricePLN = useMemo(() => {
        if (promotion === "none") return "0.00"
        return PRICES.auction[promotion]
    }, [promotion])

    useEffect(() => {
        setPaymentCompleted(false)
        setPaypalOrderId(null)
        setIsPaying(false)
    }, [promotion])
// 👇 ПОТОМ любая логика и return
    const user = getLocalUser()
    if (!user) {
        return (
            <div className="card">
                <h2>{t.addAuction.authRequired}</h2>

            </div>
        )
    }

    const safeUser = user

    // ===== VALIDATION =====
    function validateForm(): { ok: true; endsAt: number } | { ok: false; reason: string } {
        if (
            !title.trim() ||
            !description.trim() ||
            !category ||
            !voivodeship ||
            !city ||
            !startPrice ||
            imageFiles.length === 0 ||
            !endsAtDate
        ) {
            return { ok: false, reason: t.addAuction.errors.required }

        }

        const createdAt = Date.now()
        const endsAt = new Date(endsAtDate).getTime()
        const maxEndsAt = createdAt + 10 * DAY

        if (Number.isNaN(endsAt)) return { ok: false, reason: t.addAuction.errors.invalidDate }
        if (endsAt <= createdAt) return { ok: false, reason: t.addAuction.errors.pastDate }
        if (endsAt > maxEndsAt) return { ok: false, reason: t.addAuction.errors.tooLong }
        return { ok: true, endsAt }
    }

    async function checkTopLimitIfNeeded() {
        if (promotion !== "top-auction" && promotion !== "featured") return

        await checkAuctionPromotionAvailability({
            voivodeship,
            city,
            type: promotion === "top-auction" ? "top" : "featured",
        })



    }

    async function loadPromotionInfo(type: "top" | "featured") {
        if (!voivodeship || !city) {
            setPromotionInfo(null)
            return
        }

        const res = await checkAuctionPromotionAvailability({ voivodeship, city, type })

        if (res.ok) {
            setPromotionInfo({
                text: t.addAuction.promotion.freeSlots
                    .replace("{{count}}", String(res.limit - res.activeCount))
                    .replace("{{max}}", String(res.limit)),
                isQueue: false,
            })
            return
        }

        setPromotionInfo({
            text: `${t.addAuction.promotion.queue} (${res.queueCount})`,
            isQueue: true,

        })

    }


    async function createAuction() {
        try {
            await assertUserNotBlocked(safeUser.id)
        } catch (error) {
            setError(isAccountRestrictedError(error) ? t.common.accountRestricted : t.addAuction.errors.createFailed)
            return
        }

        const validation = validateForm()
        if (!validation.ok) {
            setError(validation.reason)
            throw new Error(validation.reason)
        }

        await checkTopLimitIfNeeded()

        const createdAt = Date.now()
        const endsAt = validation.endsAt


        const imageUrls: string[] = []
        for (const file of imageFiles) {
            const imageRef = ref(storage, `auctions/${safeUser.id}/${createdAt}-${file.name}`)
            await uploadBytes(imageRef, file)
            const imageUrl = await getDownloadURL(imageRef)
            imageUrls.push(imageUrl)
        }

        const docRef =    await addDoc(collection(db, "auctions"), {
            title: title.trim(),
            description: description.trim(),
            category,
            voivodeship,
            city,

            startPrice: Number(startPrice),
            buyNowPrice: null,
            currentBid: Number(startPrice),
            bidsCount: 0,

            images: imageUrls,

            ownerId: safeUser.id,
            ownerName: safeUser.nickname || "User",

            status: isPaidPromotion ? "pending_payment" : "active",
            createdAt,
            endsAt,

            promotionType: "none",
            promotionUntil: null,
            promotionQueueAt: null,
        })
        if (promotion !== "none") {
            if (!paypalOrderId) {
                setError(t.addAuction.errors.paypalError)
                throw new Error(t.addAuction.errors.paypalError)
            }

            const paymentResult = await verifyPayPalPayment({
                orderId: paypalOrderId,
                targetType: "auction",
                targetId: docRef.id,
                promotionType: promotion,
            })

            if (!paymentResult.data?.ok) {
                throw new Error(t.addAuction.errors.paypalError)
            }
        }

        navigate("/auctions")
    }

    // ===== SUBMIT (ТОЛЬКО для бесплатного) =====
    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)

        if (isPaidPromotion && !paymentCompleted) {
            const v = validateForm()
            if (!v.ok) setError(v.reason)
            else setError(t.addAuction.errors.paypalFirst)

            return
        }

        try {
            setIsSubmitting(true)
            await createAuction()
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Помилка при створенні аукціону"
            setError(msg)
        } finally {
            setIsSubmitting(false)
        }
    }

    const isFormValid =
        title.trim() &&
        description.trim() &&
        category &&
        voivodeship &&
        city &&
        startPrice &&
        imageFiles.length > 0 &&
        endsAtDate

    return (
        <div className="card stack12">
            <h2 className="h2">{t.addAuction.title}</h2>



            <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => navigate("/add")}>
                    {t.addAuction.modes.ad}
                </button>

                <button type="button" className="btn-primary" disabled>
                    {t.addAuction.modes.auction}
                </button>
            </div>

            <form className="stack12" onSubmit={handleSubmit}>

                <input className="input" placeholder={t.addAuction.fields.title} value={title}
                       onChange={(e) => setTitle(e.target.value)}/>
                <textarea className="input" placeholder={t.addAuction.fields.description} value={description}
                          onChange={(e) => setDescription(e.target.value)}/>
                <select className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                    <option value="">{t.addAuction.fields.category}</option>
                    <option value="sell">{t.addAuction.categories.sell}</option>
                    <option value="buy">{t.addAuction.categories.buy}</option>
                    <option value="service">{t.addAuction.categories.service}</option>
                    <option value="rent">{t.addAuction.categories.rent}</option>
                </select>

                <select className="input" value={voivodeship} onChange={(e) => {
                    setVoivodeship(e.target.value);
                    setCity("");
                    setPromotionInfo(null)
                }}>
                    <option value="">{t.addAuction.fields.voivodeship}</option>
                    {Object.keys(CITIES_BY_VOIVODESHIP).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>

                {voivodeship && (
                    <select className="input" value={city} onChange={(e) => setCity(e.target.value)}>
                        <option value="">{t.addAuction.fields.city}</option>
                        {(CITIES_BY_VOIVODESHIP[voivodeship as VoivodeshipKey] ?? []).map((c) => <option key={c}
                                                                                                         value={c}>{c}</option>)}
                    </select>
                )}

                <input className="input" type="number" placeholder={t.addAuction.fields.startPrice} value={startPrice}
                       onChange={(e) => setStartPrice(e.target.value)}/>
                <input className="input" type="date" value={endsAtDate}
                       onChange={(e) => setEndsAtDate(e.target.value)}/>
                <div style={{fontSize: 13, color: "#6b7280"}}>{t.addAuction.fields.maxDaysHint}</div>

                <input type="file" accept="image/*" multiple onChange={(e) => {
                    const newFiles = Array.from(e.target.files ?? [])
                    if (imageFiles.length + newFiles.length > 5) {
                        setError(t.addAuction.errors.maxImages)
                        return
                    }
                    setImageFiles((prev) => [...prev, ...newFiles])
                    e.currentTarget.value = ""
                }}/>


                {imageFiles.length > 0 && (
                    <div style={{display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8}}>
                        {imageFiles.map((file, index) => {
                            const url = URL.createObjectURL(file)
                            return <div key={index} style={{ position: "relative", width: 80, height: 80, borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
                                <img src={url} alt={`preview-${index}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                <button type="button" onClick={() => setImageFiles((prev) => prev.filter((_, i) => i !== index))} style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer", fontSize: 14, lineHeight: "22px", textAlign: "center" }} aria-label="Видалити фото">×</button>
                            </div>
                        })}
                    </div>
                )}

                {error && <div style={{ color: "#b91c1c" }}>{error}</div>}
                <div className="card stack12">
                    <strong>{t.addAuction.promotion.title}</strong>
                    <Link
                        to="/promotion-info"
                        style={{fontSize: 13, color: "#2563eb", width: "fit-content"}}
                    >
                        {t.promotionInfo.linkLabel}
                    </Link>
                    {isPaidPromotion && (
                        <div className="card stack12">
                            <strong>{t.addAuction.payment.title}</strong>
                            {!isFormValid && <div>{t.addAuction.payment.fillBeforePay}</div>}
                            {isFormValid && <>
                                <div style={{ fontSize: 13, color: "#6b7280" }}>{t.addAuction.payment.queueInfo}</div>
                                <div style={{ fontWeight: 700 }}>{t.addAuction.payment.amount}: {pricePLN} PLN</div>
                                {paymentCompleted ? (
                                    <div style={{
                                        padding: 12,
                                        borderRadius: 8,
                                        border: "1px solid #16a34a",
                                        background: "#ecfdf5",
                                        color: "#166534",
                                        fontSize: 14,
                                    }}>
                                        {paymentSuccessMessage}
                                    </div>
                                ) : (
                                    <PayPalCheckoutButton
                                        amountPLN={pricePLN}
                                        description="Ozen Board - auction promotion"
                                        disabled={isPaying}
                                        paymentCompleted={paymentCompleted}
                                        orderId={paypalOrderId}
                                        onApprove={async (orderId) => {
                                            setError(null)
                                            setIsPaying(true)

                                            try {
                                                const paymentResult = await verifyPayPalPayment({
                                                    orderId,
                                                    targetType: "auction",
                                                    promotionType: promotion,
                                                })

                                                if (!paymentResult.data?.ok) {
                                                    throw new Error(t.addAuction.errors.paypalError)
                                                }

                                                setPaypalOrderId(orderId)
                                                setPaymentCompleted(true)
                                            } finally {
                                                setIsPaying(false)
                                            }
                                        }}
                                        onError={(message) => {
                                            if (paymentCompleted || paypalOrderId) return
                                            setIsPaying(false)
                                            setError(message || t.addAuction.errors.paypalError)
                                        }}
                                    />
                                )}
                            </>}
                        </div>
                    )}

                    <label className="promotion-option">
                        <input type="radio" name="promotion" checked={promotion === "none"}
                               onChange={() => setPromotion("none")}
                               disabled={paymentCompleted || isPaying}/>
                        🆓 {t.addAuction.promotion.none}
                        <div className="hint">{t.addAuction.promotion.noneHint}</div>

                    </label>

                    <label className="promotion-option">
                        <input type="radio" name="promotion" checked={promotion === "top-auction"}
                               onChange={async () => {
                                   setPromotion("top-auction");
                                   await loadPromotionInfo("top")
                               }}
                               disabled={paymentCompleted || isPaying}/>
                        🔥 {t.addAuction.promotion.top}
                        <div className="hint">{t.addAuction.promotion.topHint}</div>

                    </label>

                    <label className="promotion-option">
                        <input type="radio" name="promotion" checked={promotion === "featured"} onChange={async () => {
                            setPromotion("featured");
                            await loadPromotionInfo("featured")
                        }}
                               disabled={paymentCompleted || isPaying}/>
                        ⭐ {t.addAuction.promotion.featured}
                        <div className="hint">{t.addAuction.promotion.featuredHint}</div>

                    </label>

                    <label className="promotion-option">
                        <input type="radio" name="promotion" checked={promotion === "highlight-gold"}
                               onChange={() => setPromotion("highlight-gold")}
                               disabled={paymentCompleted || isPaying}/>
                        ✨ {t.addAuction.promotion.gold}
                        <div className="hint">{t.addAuction.promotion.goldHint}</div>

                    </label>

                    {promotionInfo && <div style={{ fontSize: 13, color: promotionInfo.isQueue ? "#b45309" : "#047857" }}>{promotionInfo.text}</div>}
                </div>

                <button className="btn-primary" disabled={isSubmitting || isPaying || (isPaidPromotion && !paymentCompleted)}>
                    {isSubmitting
                        ? t.addAuction.actions.loading
                        : isPaidPromotion && !paymentCompleted
                            ? t.addAuction.actions.pay
                            : t.addAuction.actions.create}
                </button>

            </form>
        </div>
    )
}

export default AddAuctionPage
