import { useState, useEffect } from "react"

import { useNavigate } from "react-router-dom"
import {
    addDoc,
    collection,
    getDocs,
    query,
    where,
} from "firebase/firestore"
import { PRICES } from "../config/prices"
import type { translations } from "../app/i18n"

import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import type { Ad } from "../types/ad"
import { PayPalButtons } from "@paypal/react-paypal-js"
import { verifyPayPalPayment } from "../api/payments"

import { db, storage } from "../app/firebase"
import { getLocalUser } from "../data/localUser"

import { CITIES_BY_VOIVODESHIP } from "../data/cities"
import { checkPinAvailability } from "../data/pinAvailability"
type Props = {
    t: (typeof translations)[keyof typeof translations]
}




type Category = "work" | "sell" | "buy" | "service" | "rent"
type VoivodeshipKey = keyof typeof CITIES_BY_VOIVODESHIP

function AddPage({ t }: Props) {
    const a = t.add
    const navigate = useNavigate()
    const user = getLocalUser()
    const AD_COOLDOWN_MS = 60_000 // 60 секунд

    // --- state ---
    const [title, setTitle] = useState("")
    const [description, setDescription] = useState("")
    const [category, setCategory] = useState<Category | "">("")
    const [voivodeship, setVoivodeship] = useState("")
    const [city, setCity] = useState("")
    const [price, setPrice] = useState("")
    const [imageFiles, setImageFiles] = useState<File[]>([])

    const [sellerContact, setSellerContact] = useState("")

    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    type PromotionType =
        | 'none'
        | 'top3'
        | 'top6'
        | 'bump'
        | 'highlight-gold'

    const [promotion, setPromotion] = useState<PromotionType>('none')



    const [pinInfo, setPinInfo] = useState<{
        canTop3: boolean
        canTop6: boolean
        top3Used: number
        top6Used: number
    } | null>(null)


    const [pinLoading, setPinLoading] = useState(false)
    const [paymentCompleted, setPaymentCompleted] = useState(false)
    const [paypalOrderId, setPaypalOrderId] = useState<string | null>(null)

    useEffect(() => {
        setPaymentCompleted(false)
        setPaypalOrderId(null)
    }, [promotion])

    useEffect(() => {
        let cancelled = false

        async function run() {
            if (!city) {
                setPinInfo(null)
                return
            }

            try {
                setPinLoading(true)
                const info = await checkPinAvailability(city)
                if (cancelled) return
                setPinInfo(info)


            } catch (e) {
                console.error(e)
                if (cancelled) return
                setPinInfo(null)
            } finally {
                if (!cancelled) setPinLoading(false)
            }
        }

        run()
        return () => {
            cancelled = true
        }
    }, [city])

    // --- если не залогинен ---
    if (!user) {
        return (
            <div className="card">
                <h2>{a.authRequired}</h2>

            </div>
        )
    }
    const safeUser = user

    const userId = safeUser.id

    function getCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                resolve(null)
                return
            }

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    resolve({
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                    })
                },
                () => resolve(null)
            )
        })
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)

        if (
            !title.trim() ||
            !description.trim() ||
            !category ||
            !voivodeship ||
            !city ||
            !price.trim()
        ) {
            setError(a.errors.required)

            return
        }

        if (imageFiles.length === 0) {
            setError(a.errors.noImages)

            return
        }

        const lastAdTime = localStorage.getItem("lastAdCreatedAt")

        if (lastAdTime) {
            const diff = Date.now() - Number(lastAdTime)

            if (diff < AD_COOLDOWN_MS) {
                setError(
                    a.cooldown.text.replace(
                        "{{seconds}}",
                        String(Math.ceil((AD_COOLDOWN_MS - diff) / 1000))
                    )
                )

                return
            }
        }



        const DAY_MS = 24 * 60 * 60 * 1000
        const since = Date.now() - DAY_MS

// лимит объявлений
        const MAX_ADS_PER_USER = 10

        const userAdsCount = await getDocs(
            query(
                collection(db, "ads"),
                where("userId", "==", userId),
                where("createdAt", ">=", since)


            )
        )

        if (userAdsCount.size >= MAX_ADS_PER_USER) {
            setError(a.errors.limitReached)

            return
        }
// если выбрали PIN — перепроверяем лимит прямо перед созданием



        try {
            setIsSubmitting(true)
            const timestamp = Date.now()
            const location = await getCurrentLocation()


            // upload фото
            // upload фото (мульти)
            const imageUrls: string[] = []

            for (const file of imageFiles) {
                const imageRef = ref(
                    storage,
                    `ads/${userId}/${timestamp}-${file.name}`
                )

                await uploadBytes(imageRef, file)
                const imageUrl = await getDownloadURL(imageRef)
                imageUrls.push(imageUrl)
            }
            let pinFields: Partial<Ad> = {}

            if ((promotion === 'top3' || promotion === 'top6') && city) {
                const info = await checkPinAvailability(city)

                if (promotion === 'top3') {
                    pinFields = info.canTop3
                        ? {
                            pinType: 'top3',
                            pinnedAt: timestamp,
                            pinnedUntil: timestamp + 3 * 24 * 60 * 60 * 1000,
                        }
                        : {
                            pinType: 'top3',
                            pinQueueAt: timestamp,
                        }
                }

                if (promotion === 'top6') {
                    pinFields = info.canTop6
                        ? {
                            pinType: 'top6',
                            pinnedAt: timestamp,
                            pinnedUntil: timestamp + 3 * 24 * 60 * 60 * 1000,
                        }
                        : {
                            pinType: 'top6',
                            pinQueueAt: timestamp,
                        }
                }
            }


            const adData: Omit<Ad, "id"> = {
                title: title.trim(),
                description: description.trim(),
                category,
                voivodeship,
                city,
                price: price.trim(),
                images: imageUrls,

                userId,
                createdAt: timestamp,
                status: "active",

                ...(location ? { location } : {}),

                // ===== платные опции (если выбраны) =====
                ...(promotion === 'bump'
                    ? { bumpAt: timestamp }
                    : {}),



                ...(promotion === 'highlight-gold'
                    ? {
                        highlightType: 'gold',
                        highlightUntil: timestamp + 7 * 24 * 60 * 60 * 1000,
                    }
                    : {}),
                ...pinFields,
            }






            const docRef = await addDoc(collection(db, "ads"), adData)

            if (promotion !== "none") {
                if (!paypalOrderId) {
                    setError(a.errors.paymentNotConfirmed)

                    return
                }


                await verifyPayPalPayment({
                    orderId: paypalOrderId,
                    targetType: "ad",
                    targetId: docRef.id,
                    promotionType:
                        promotion === "highlight-gold" ? "gold" : promotion,
                })
            }





            // addLocalAd({
            //     id: docRef.id,
            //     ...adData,
            // })
            setSellerContact("")

            navigate("/")
        } catch (err) {
            console.error(err)
            setError(a.errors.createFailed)

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
        price.trim() &&
        imageFiles.length > 0


    return (
        <div className="card stack12">
            <h2 className="h2">{a.title}</h2>


            {/* 🔹 Переключатель режимов */}
            <div style={{display: "flex", gap: 8}}>
                <button
                    type="button"
                    className="btn-primary"
                    disabled
                >
                    {a.modes.ad}
                </button>

                <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => navigate("/add-auction")}
                >
                    {a.modes.auction}
                </button>
            </div>


            <form className="stack12" onSubmit={handleSubmit}>
                <input
                    className="input"
                    placeholder={a.fields.title}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                />


                <textarea
                    className="input"
                    placeholder={a.fields.description}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                />

                <select
                    className="input"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as Category)}
                >
                    <option value="">{a.categories.label}</option>
                    <option value="work">{a.categories.work}</option>
                    <option value="sell">{a.categories.sell}</option>
                    <option value="buy">{a.categories.buy}</option>
                    <option value="service">{a.categories.service}</option>
                    <option value="rent">{a.categories.rent}</option>

                </select>

                <select
                    className="input"
                    value={voivodeship}
                    onChange={(e) => {
                        setVoivodeship(e.target.value)
                        setCity("")
                    }}
                >
                    <option value="">{a.location.voivodeship}</option>
                    {Object.keys(CITIES_BY_VOIVODESHIP).map((v) => (
                        <option key={v} value={v}>
                            {v}
                        </option>
                    ))}
                </select>

                {voivodeship && (
                    <select
                        className="input"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                    >
                        <option value="">{a.location.city}</option>
                        {(CITIES_BY_VOIVODESHIP[voivodeship as VoivodeshipKey] ??
                            []).map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </select>
                )}

                <input
                    className="input"
                    placeholder={a.fields.price}
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                />
                <input
                    className="input"
                    placeholder={a.fields.contact}

                    value={sellerContact}
                    onChange={(e) => setSellerContact(e.target.value)}
                />

                <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                        const newFiles = Array.from(e.target.files ?? [])

                        if (imageFiles.length + newFiles.length > 5) {
                            setError(a.errors.maxImages)

                            return
                        }

                        setImageFiles((prev) => [...prev, ...newFiles])

                        // важно: чтобы можно было выбрать те же файлы ещё раз
                        e.currentTarget.value = ""
                    }}
                />
                {/* Превʼю вибраних фото */}
                {imageFiles.length > 0 && (
                    <div
                        style={{
                            display: "flex",
                            gap: "8px",
                            flexWrap: "wrap",
                            marginTop: "8px",
                        }}
                    >
                        {imageFiles.map((file, index) => {
                            const url = URL.createObjectURL(file)

                            return (
                                <div
                                    key={index}
                                    style={{
                                        position: "relative",
                                        width: "80px",
                                        height: "80px",
                                        borderRadius: "8px",
                                        overflow: "hidden",
                                        border: "1px solid #e5e7eb",
                                    }}
                                >
                                    <img
                                        src={url}
                                        alt={`preview-${index}`}
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "cover",
                                        }}
                                    />

                                    {/* Кнопка удаления */}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setImageFiles((prev) =>
                                                prev.filter((_, i) => i !== index)
                                            )
                                        }}
                                        style={{
                                            position: "absolute",
                                            top: "4px",
                                            right: "4px",
                                            width: "22px",
                                            height: "22px",
                                            borderRadius: "50%",
                                            border: "none",
                                            background: "rgba(0,0,0,0.6)",
                                            color: "#fff",
                                            cursor: "pointer",
                                            fontSize: "14px",
                                        }}
                                    >
                                        ×
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                )}


                {error && (
                    <div style={{color: "#b91c1c", fontSize: "14px"}}>
                        {error}
                    </div>
                )}
                <div className="card stack12">
                    <strong>{a.promotion.title}</strong>

                    {promotion !== 'none' && (
                        <div className="card stack12">
                            <strong>{a.payment.title}</strong>

                            {!isFormValid && (
                                <div>{a.payment.fillBeforePay}</div>
                            )}

                            {isFormValid && (
                                <>
                                    <div style={{fontSize: 16}}>
                                        {a.payment.amount}:{" "}
                                        <strong>
                                            {promotion === "highlight-gold"
                                                ? PRICES.ad.gold
                                                : PRICES.ad[promotion]} PLN
                                        </strong>
                                    </div>

                                    <PayPalButtons
                                        style={{layout: "vertical"}}
                                        createOrder={(_, actions) => {
                                            return actions.order.create({
                                                intent: "CAPTURE",
                                                purchase_units: [
                                                    {
                                                        amount: {
                                                            value:
                                                                promotion === "highlight-gold"
                                                                    ? PRICES.ad.gold
                                                                    : PRICES.ad[promotion],
                                                            currency_code: "PLN",
                                                        },
                                                    },
                                                ],
                                            })
                                        }}
                                        onApprove={async (_, actions) => {
                                            if (!actions.order) return
                                            const details = await actions.order.capture()

                                            setPaypalOrderId(details.id!)
                                            setPaymentCompleted(true)
                                        }}
                                    />
                                </>
                            )}
                        </div>
                    )}

                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === 'none'}
                            onChange={() => setPromotion('none')}
                        />
                        🆓 Без просування
                        <div className="hint">{a.promotion.noneHint}
                        </div>
                    </label>

                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === 'top3'}
                            onChange={() => setPromotion('top3')}
                            disabled={pinLoading}
                        />
                        🔥 TOP 3

                        <div className="hint">
                            {a.promotion.top3Hint}

                            {pinInfo && (
                                <div style={{fontSize: 12, marginTop: 4, opacity: 0.8}}>
                                    {pinInfo.canTop3
                                        ? a.promotion.freeSlots
                                            .replace("{{count}}", String(3 - pinInfo.top3Used))
                                            .replace("{{max}}", "3")
                                        : a.promotion.queue}

                                </div>
                            )}
                        </div>
                    </label>


                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === 'top6'}
                            onChange={() => setPromotion('top6')}
                            disabled={pinLoading}
                        />
                        ⭐ TOP 6

                        <div className="hint">
                            {a.promotion.top6Hint}
                            {pinInfo && (
                                <div style={{fontSize: 12, marginTop: 4, opacity: 0.8}}>
                                    {pinInfo.canTop6
                                        ? a.promotion.freeSlots
                                            .replace("{{count}}", String(6 - pinInfo.top6Used))
                                            .replace("{{max}}", "6")
                                        : a.promotion.queue}


                                </div>
                            )}
                        </div>
                    </label>


                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === 'bump'}
                            onChange={() => setPromotion('bump')}
                        />
                        🚀 {a.promotion.bump}
                        <div className="hint">{a.promotion.bumpHint}</div>

                    </label>

                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === 'highlight-gold'}
                            onChange={() => setPromotion('highlight-gold')}
                        />
                        ✨ {a.promotion.gold}
                        <div className="hint">{a.promotion.goldHint}</div>

                    </label>
                </div>


                <button
                    className="btn-primary"
                    disabled={
                        isSubmitting ||
                        (promotion !== 'none' && !paymentCompleted)
                    }
                >

                    {isSubmitting ? a.actions.loading : a.actions.submit}

                </button>
            </form>
        </div>
    )
}

export default AddPage
