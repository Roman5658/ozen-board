import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import { collection, addDoc } from "firebase/firestore"
import { doc, updateDoc } from "firebase/firestore"
import { PRICES } from "../config/prices"

import { db, storage } from "../app/firebase"
import { getLocalUser } from "../data/localUser"
import { CITIES_BY_VOIVODESHIP } from "../data/cities"
import { checkAuctionPromotionAvailability } from "../data/auctionAvailability"


import { PayPalButtons } from "@paypal/react-paypal-js"
import { verifyPayPalPayment } from "../api/payments"

type Category = "sell" | "buy" | "service" | "rent"
type VoivodeshipKey = keyof typeof CITIES_BY_VOIVODESHIP

type AuctionPromotion =
    | "none"
    | "top-auction"
    | "featured"
    | "highlight-gold"

const DAY = 24 * 60 * 60 * 1000

function AddAuctionPage() {
    const navigate = useNavigate()

    // ===== STATE =====
    const [title, setTitle] = useState("")
    const [description, setDescription] = useState("")
    const [category, setCategory] = useState<Category | "">("")
    const [voivodeship, setVoivodeship] = useState("")
    const [city, setCity] = useState("")
    const [startPrice, setStartPrice] = useState("")
    const [buyNowPrice, setBuyNowPrice] = useState("")
    const [imageFiles, setImageFiles] = useState<File[]>([])
    const [endsAtDate, setEndsAtDate] = useState("")

    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [promotion, setPromotion] = useState<AuctionPromotion>("none")
    const [isPaying, setIsPaying] = useState(false)
    const [draftAuctionId, setDraftAuctionId] = useState<string | null>(null)

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


// 👇 ПОТОМ любая логика и return
    const user = getLocalUser()
    if (!user) {
        return (
            <div className="card">
                <h2>Спочатку увійдіть в акаунт</h2>
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
            return { ok: false, reason: "Заповніть всі обовʼязкові поля" }
        }

        const createdAt = Date.now()
        const endsAt = new Date(endsAtDate).getTime()
        const maxEndsAt = createdAt + 10 * DAY

        if (Number.isNaN(endsAt)) {
            return { ok: false, reason: "Некоректна дата завершення" }
        }

        if (endsAt <= createdAt) {
            return { ok: false, reason: "Дата завершення має бути пізніше сьогодні" }
        }

        if (endsAt > maxEndsAt) {
            return { ok: false, reason: "Аукціон може тривати максимум 10 днів" }
        }

        return { ok: true, endsAt }
    }

    async function checkTopLimitIfNeeded() {
        if (promotion !== "top-auction" && promotion !== "featured") return

        await checkAuctionPromotionAvailability({
            voivodeship,
            city,
            type: promotion === "top-auction" ? "top" : "featured",
        })


        // ❗ НИЧЕГО НЕ БЛОКИРУЕМ
        // очередь — это допустимое состояние
        return
    }

    async function loadPromotionInfo(type: "top" | "featured") {
        if (!voivodeship || !city) {
            setPromotionInfo(null)
            return
        }

        const res = await checkAuctionPromotionAvailability({
            voivodeship,
            city,
            type,
        })

        if (res.ok) {
            setPromotionInfo({
                text: `Вільно: ${res.limit - res.activeCount} з ${res.limit}`,
                isQueue: false,
            })
        } else {
            setPromotionInfo({
                text: `Місць немає — буде додано в чергу (${res.queueCount} у черзі)`,
                isQueue: true,
            })
        }
    }

// ===== CREATE DRAFT AUCTION (до оплаты) =====
// Создаёт "черновик" и возвращает реальный auctionId
    async function createDraftAuction(): Promise<string> {
        const validation = validateForm()
        if (!validation.ok) {
            setError(validation.reason)
            throw new Error(validation.reason)
        }

        await checkTopLimitIfNeeded()

        const createdAt = Date.now()
        const endsAt = validation.endsAt

        // 1) загружаем фото сразу (можно и после оплаты, но так проще для MVP)
        const imageUrls: string[] = []
        for (const file of imageFiles) {
            const imageRef = ref(storage, `auctions/${safeUser.id}/${createdAt}-${file.name}`)
            await uploadBytes(imageRef, file)
            const imageUrl = await getDownloadURL(imageRef)
            imageUrls.push(imageUrl)
        }

        // 2) создаём документ и получаем ID
        const docRef = await addDoc(collection(db, "auctions"), {
            title: title.trim(),
            description: description.trim(),
            category,
            voivodeship,
            city,

            startPrice: Number(startPrice),
            buyNowPrice: buyNowPrice ? Number(buyNowPrice) : null,
            currentBid: Number(startPrice),
            bidsCount: 0,

            images: imageUrls,

            ownerId: safeUser.id,
            ownerName: safeUser.nickname || "User",

            // ВАЖНО: draft
            status: "draft",

            createdAt,
            endsAt,

            // пока без промо — промо включим только после verifyPayPalPayment
            promotionType: promotion === "top-auction" ? "top" :
                promotion === "featured" ? "featured" :
                    promotion === "highlight-gold" ? "gold" :
                        "none",

            promotionUntil: null,

            promotionQueueAt:
                promotion === "top-auction" || promotion === "featured"
                    ? Date.now()
                    : null,

        })

        return docRef.id
    }

    // ===== CREATE AUCTION (ЕДИНСТВЕННОЕ место, где создаётся аукцион) =====
    async function createAuction() {
        const validation = validateForm()
        if (!validation.ok) {
            setError(validation.reason)
            throw new Error(validation.reason)
        }

        await checkTopLimitIfNeeded()

        const createdAt = Date.now()
        const endsAt = validation.endsAt

        // upload images
        const imageUrls: string[] = []
        for (const file of imageFiles) {
            const imageRef = ref(storage, `auctions/${safeUser.id}/${createdAt}-${file.name}`)
            await uploadBytes(imageRef, file)
            const imageUrl = await getDownloadURL(imageRef)
            imageUrls.push(imageUrl)
        }

        // promotionUntil (твои сроки: 3/3/7)
        const promotionUntil =
            promotion === "highlight-gold"
                ? createdAt + 7 * DAY
                : promotion === "featured"
                    ? createdAt + 3 * DAY
                    : promotion === "top-auction"
                        ? createdAt + 3 * DAY
                        : null

        await addDoc(collection(db, "auctions"), {
            title: title.trim(),
            description: description.trim(),
            category,
            voivodeship,
            city,

            startPrice: Number(startPrice),
            buyNowPrice: buyNowPrice ? Number(buyNowPrice) : null,
            currentBid: Number(startPrice),
            bidsCount: 0,

            images: imageUrls,

            ownerId: safeUser.id,
            ownerName: safeUser.nickname || "User",

            status: "active",
            createdAt,
            endsAt,

            promotionType: promotion,
            promotionUntil,
        })

        navigate("/auctions")
    }

    // ===== SUBMIT (ТОЛЬКО для бесплатного) =====
    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)

        // если платное — НЕ создаем через submit
        if (isPaidPromotion) {
            const v = validateForm()
            if (!v.ok) setError(v.reason)
            else setError("Спочатку виконайте оплату PayPal нижче.")
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

    // ===== UI =====
    return (
        <div className="card stack12">
            <h2 className="h2">Створити аукціон</h2>

            {/* Перемикач */}
            <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => navigate("/add")}>
                    Оголошення
                </button>

                <button type="button" className="btn-primary" disabled>
                    Аукціон
                </button>
            </div>

            <form className="stack12" onSubmit={handleSubmit}>
                <input
                    className="input"
                    placeholder="Заголовок"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                />

                <textarea
                    className="input"
                    placeholder="Опис"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                />

                <select className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                    <option value="">Категорія</option>
                    <option value="sell">Продам</option>
                    <option value="buy">Куплю</option>
                    <option value="service">Послуги</option>
                    <option value="rent">Оренда</option>
                </select>

                <select
                    className="input"
                    value={voivodeship}
                    onChange={(e) => {
                        setVoivodeship(e.target.value)
                        setCity("")
                        setPromotionInfo(null)

                    }}
                >
                    <option value="">Воєводство</option>
                    {Object.keys(CITIES_BY_VOIVODESHIP).map((v) => (
                        <option key={v} value={v}>
                            {v}
                        </option>
                    ))}
                </select>

                {voivodeship && (
                    <select className="input" value={city} onChange={(e) => setCity(e.target.value)}>
                        <option value="">Місто</option>
                        {(CITIES_BY_VOIVODESHIP[voivodeship as VoivodeshipKey] ?? []).map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </select>
                )}

                <input
                    className="input"
                    type="number"
                    placeholder="Стартова ціна"
                    value={startPrice}
                    onChange={(e) => setStartPrice(e.target.value)}
                />

                <input
                    className="input"
                    type="number"
                    placeholder="Купити зараз (необовʼязково)"
                    value={buyNowPrice}
                    onChange={(e) => setBuyNowPrice(e.target.value)}
                />

                <input className="input" type="date" value={endsAtDate} onChange={(e) => setEndsAtDate(e.target.value)} />

                <div style={{ fontSize: 13, color: "#6b7280" }}>Максимум 10 днів від сьогодні</div>

                <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                        const newFiles = Array.from(e.target.files ?? [])
                        if (imageFiles.length + newFiles.length > 5) {
                            setError("Максимум 5 фото")
                            return
                        }
                        setImageFiles((prev) => [...prev, ...newFiles])
                        e.currentTarget.value = ""
                    }}
                />

                {/* Превʼю */}
                {imageFiles.length > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                        {imageFiles.map((file, index) => {
                            const url = URL.createObjectURL(file)
                            return (
                                <div
                                    key={index}
                                    style={{
                                        position: "relative",
                                        width: 80,
                                        height: 80,
                                        borderRadius: 8,
                                        overflow: "hidden",
                                        border: "1px solid #e5e7eb",
                                    }}
                                >
                                    <img src={url} alt={`preview-${index}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    <button
                                        type="button"
                                        onClick={() => setImageFiles((prev) => prev.filter((_, i) => i !== index))}
                                        style={{
                                            position: "absolute",
                                            top: 4,
                                            right: 4,
                                            width: 22,
                                            height: 22,
                                            borderRadius: "50%",
                                            border: "none",
                                            background: "rgba(0,0,0,0.6)",
                                            color: "#fff",
                                            cursor: "pointer",
                                            fontSize: 14,
                                            lineHeight: "22px",
                                            textAlign: "center",
                                        }}
                                        aria-label="Видалити фото"
                                    >
                                        ×
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                )}

                {/* PROMOTION */}
                <div className="card stack12">
                    <strong>Просування аукціону</strong>

                    <label className="promotion-option">
                        <input type="radio" name="promotion" checked={promotion === "none"} onChange={() => setPromotion("none")} />
                        🆓 Без просування
                        <div className="hint">Звичайний аукціон</div>
                    </label>

                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === "top-auction"}
                            onChange={async () => {
                                setPromotion("top-auction")
                                await loadPromotionInfo("top")
                            }}
                        />

                        🔥 TOP аукціон
                        <div className="hint">Показується вище звичайних аукціонів (3 дні)</div>
                    </label>

                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === "featured"}
                            onChange={async () => {
                                setPromotion("featured")
                                await loadPromotionInfo("featured")
                            }}
                        />
                        ⭐ Featured
                        <div className="hint">Виділений аукціон (3 дні)</div>
                    </label>

                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === "highlight-gold"}
                            onChange={() => setPromotion("highlight-gold")}
                        />
                        ✨ Виділити (gold)
                        <div className="hint">Кольорове виділення (7 днів)</div>
                    </label>
                    {promotionInfo && (
                        <div
                            style={{
                                fontSize: 13,
                                color: promotionInfo.isQueue ? "#b45309" : "#047857",
                            }}
                        >
                            {promotionInfo.text}
                        </div>
                    )}

                    {/* PAYPAL (только если платное) */}
                    {isPaidPromotion && (
                        <div className="card stack12">
                            <strong>Оплата просування</strong>

                            <div style={{ fontSize: 13, color: "#6b7280" }}>
                                Після успішної оплати аукціон створиться автоматично.
                            </div>

                            <div style={{ fontWeight: 700 }}>Сума: {pricePLN} PLN</div>

                            <PayPalButtons
                                style={{ layout: "vertical" }}
                                disabled={isPaying}
                                createOrder={async (_, actions) => {
                                    const v = validateForm()
                                    if (!v.ok) {
                                        setError(v.reason)
                                        throw new Error(v.reason)
                                    }

                                    // 1️⃣ создаём draft и сохраняем ID
                                    const auctionId = await createDraftAuction()
                                    setDraftAuctionId(auctionId)

                                    // 2️⃣ создаём PayPal order
                                    return actions.order.create({
                                        intent: "CAPTURE",
                                        purchase_units: [
                                            {
                                                amount: {
                                                    value: pricePLN,
                                                    currency_code: "PLN",
                                                },
                                            },
                                        ],
                                    })
                                }}

                                onApprove={async (_, actions) => {
                                    if (!actions.order) return
                                    setError(null)
                                    setIsPaying(true)

                                    try {
                                        // 1) capture
                                        const details = await actions.order.capture()

                                        if (!details.id) {
                                            throw new Error("PayPal order id missing")
                                        }

                                        await verifyPayPalPayment({
                                            orderId: details.id,
                                            targetType: "auction",
                                            targetId: draftAuctionId!,
                                            promotionType: promotion,
                                        })


// 3) activate draft
                                        await updateDoc(doc(db, "auctions", draftAuctionId!), {
                                            status: "active",
                                            promotionQueueAt: null, // очередь обработана сервером
                                        })


                                        navigate("/auctions")

                                    } catch (err) {
                                        const msg = err instanceof Error ? err.message : "Помилка PayPal"
                                        setError(msg)
                                    } finally {
                                        setIsPaying(false)
                                        setIsSubmitting(false)
                                    }
                                }}
                                onError={(err) => {
                                    console.error(err)
                                    setError("Помилка PayPal")
                                }}
                            />
                        </div>
                    )}
                </div>

                {error && <div style={{ color: "#b91c1c" }}>{error}</div>}

                {/* Кнопка нужна ТОЛЬКО для бесплатного */}
                <button className="btn-primary" disabled={isSubmitting || isPaying || isPaidPromotion}>
                    {isPaidPromotion ? "Оплатіть PayPal нижче" : isSubmitting ? "Завантаження..." : "Створити аукціон"}
                </button>
            </form>
        </div>
    )
}

export default AddAuctionPage
