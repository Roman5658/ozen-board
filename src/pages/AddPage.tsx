import { useState, useEffect, useMemo } from "react"

import { Link, useNavigate } from "react-router-dom"
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
import { verifyPayPalPayment } from "../api/payments"
import PayPalCheckoutButton from "../components/PayPalCheckoutButton"

import { db, storage } from "../app/firebase"
import { getLocalUser } from "../data/localUser"
import { getFirebaseUserId, isStaleAuthSessionError, requireMatchingFirebaseUser } from "../data/authGuard"
import { assertUserNotBlocked, isAccountRestrictedError } from "../data/users"

import { CITIES_BY_VOIVODESHIP } from "../data/cities"
import { checkPinAvailability } from "../data/pinAvailability"
import {
    getImageUploadContentType,
    IMAGE_FILE_ACCEPT,
    MAX_AD_IMAGES,
    UnsupportedImageFormatError,
    optimizeAdImages,
    validateImageFiles,
} from "../utils/imageOptimization"
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
    const imagePreviews = useMemo(
        () => imageFiles.map((file) => URL.createObjectURL(file)),
        [imageFiles]
    )

    const [sellerContact, setSellerContact] = useState("")

    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isPaying, setIsPaying] = useState(false)
    type PromotionType =
        | 'none'
        | 'top3'
        | 'top6'
        | 'bump'
        | 'highlight-gold'

    const [promotion, setPromotion] = useState<PromotionType>('none')

    useEffect(() => {
        return () => {
            imagePreviews.forEach((url) => URL.revokeObjectURL(url))
        }
    }, [imagePreviews])



    const [pinInfo, setPinInfo] = useState<{
        canTop3: boolean
        canTop6: boolean
        top3Used: number
        top6Used: number
    } | null>(null)


    const [pinLoading, setPinLoading] = useState(false)
    const [paymentCompleted, setPaymentCompleted] = useState(false)
    const [paypalOrderId, setPaypalOrderId] = useState<string | null>(null)
    const PAYMENT_STORAGE_KEY = "pendingAdPayment"
    const FORM_STORAGE_KEY = "pendingAdForm"
    const paymentSuccessTitle = "✅ Оплата успешно подтверждена"
    const paymentSuccessMessage = "Теперь нажмите «Создать объявление», чтобы завершить публикацию."

    useEffect(() => {
        const savedPayment = sessionStorage.getItem(PAYMENT_STORAGE_KEY)

        if (savedPayment) {
            try {
                const parsed = JSON.parse(savedPayment)

                setPaypalOrderId(parsed.orderId)
                setPaymentCompleted(true)
                setPromotion(parsed.promotion)
            } catch (e) {
                console.error(e)
            }
        }
    }, [])
    useEffect(() => {
        const savedForm = sessionStorage.getItem(FORM_STORAGE_KEY)

        if (savedForm) {
            try {
                const parsed = JSON.parse(savedForm)

                setTitle(parsed.title ?? "")
                setDescription(parsed.description ?? "")
                setCategory(parsed.category ?? "")
                setVoivodeship(parsed.voivodeship ?? "")
                setCity(parsed.city ?? "")
                setPrice(parsed.price ?? "")
                setSellerContact(parsed.sellerContact ?? "")
            } catch (e) {
                console.error(e)
            }
        }
    }, [])
    useEffect(() => {
        sessionStorage.setItem(
            FORM_STORAGE_KEY,
            JSON.stringify({
                title,
                description,
                category,
                voivodeship,
                city,
                price,
                sellerContact,
            })
        )
    }, [title, description, category, voivodeship, city, price, sellerContact])

    useEffect(() => {
        const savedPayment = sessionStorage.getItem(PAYMENT_STORAGE_KEY)

        if (savedPayment) {
            return
        }

        if (!paymentCompleted) {
            setPaypalOrderId(null)
            setIsPaying(false)
        }
    }, [promotion, paymentCompleted])
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (paymentCompleted) {
                e.preventDefault()
                e.returnValue = ""
            }
        }

        window.addEventListener("beforeunload", handleBeforeUnload)

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload)
        }
    }, [paymentCompleted])
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
        let verifiedUserId = userId

        try {
            const authUser = await requireMatchingFirebaseUser(safeUser)
            verifiedUserId = getFirebaseUserId(authUser)
            await assertUserNotBlocked(verifiedUserId)
        } catch (error) {
            if (isStaleAuthSessionError(error)) {
                setError(error.message)
            } else {
                setError(isAccountRestrictedError(error) ? t.common.accountRestricted : a.errors.createFailed)
            }
            return
        }

// лимит объявлений
        const MAX_ADS_PER_USER = 10

        let userAdsCount
        try {
            userAdsCount = await getDocs(
                query(
                    collection(db, "ads"),
                    where("userId", "==", verifiedUserId),
                    where("createdAt", ">=", since)


                )
            )
        } catch (error) {
            console.error(error)
            setError(a.errors.createFailed)
            return
        }

        if (userAdsCount.size >= MAX_ADS_PER_USER) {
            setError(a.errors.limitReached)

            return
        }
// если выбрали PIN — перепроверяем лимит прямо перед созданием
        const isPaidPromotion = promotion !== "none"
        if (isPaidPromotion && (!paymentCompleted || !paypalOrderId)) {
            setError(a.errors.paymentNotConfirmed)

            return
        }

        try {
            setIsSubmitting(true)
            const timestamp = Date.now()
            const location = await getCurrentLocation()


            // upload фото
            // upload фото (мульти)
            const imageUrls: string[] = []
            let optimizedImages: File[] = []

            try {
                optimizedImages = await optimizeAdImages(imageFiles)
            } catch (error) {
                if (error instanceof UnsupportedImageFormatError) {
                    setError(
                        a.errors.unsupportedImageFormat.replace(
                            "{{file}}",
                            error.fileName
                        )
                    )
                    return
                }

                throw error
            }

            for (const [index, file] of optimizedImages.entries()) {
                const imageRef = ref(
                    storage,
                    `ads/${verifiedUserId}/${timestamp}-${index}-${file.name}`
                )

                await uploadBytes(imageRef, file, {
                    contentType: getImageUploadContentType(file),
                })
                const imageUrl = await getDownloadURL(imageRef)
                imageUrls.push(imageUrl)
            }
            const adData: Omit<Ad, "id"> = {
                title: title.trim(),
                description: description.trim(),
                category,
                voivodeship,
                city,
                price: price.trim(),
                ...(imageUrls.length > 0 ? { images: imageUrls } : {}),
                ...(sellerContact.trim() ? { sellerContact: sellerContact.trim() } : {}),

                userId: verifiedUserId,
                createdAt: timestamp,
                status: isPaidPromotion ? "pending_payment" : "active",

                ...(location ? { location } : {}),

                // Paid promotion fields are applied only after backend capture.
            }

            const docRef = await addDoc(collection(db, "ads"), adData)

            if (isPaidPromotion) {
                if (!paypalOrderId) {
                    setError(a.errors.paymentNotConfirmed)

                    return
                }


                const paymentResult = await verifyPayPalPayment({
                    orderId: paypalOrderId,
                    targetType: "ad",
                    targetId: docRef.id,
                    promotionType: promotion,
                })

                if (!paymentResult.data?.ok) {
                    throw new Error(a.errors.paymentNotConfirmed)
                }
            }





            // addLocalAd({
            //     id: docRef.id,
            //     ...adData,
            // })
            setSellerContact("")
            sessionStorage.removeItem(PAYMENT_STORAGE_KEY)
            sessionStorage.removeItem(FORM_STORAGE_KEY)
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
        price.trim()


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
                    maxLength={120}
                    value={sellerContact}
                    onChange={(e) => setSellerContact(e.target.value)}
                />

                <div className="stack4">
                    <div style={{fontSize: 12, color: "#64748b"}}>
                        {a.fields.photoOptional}
                    </div>
                    <div style={{fontSize: 12, color: "#64748b"}}>
                        {a.fields.photoOptimizationHint.replace(
                            "{{limit}}",
                            String(MAX_AD_IMAGES)
                        )}
                    </div>
                    <input
                        type="file"
                        accept={IMAGE_FILE_ACCEPT}
                        multiple
                        onChange={(e) => {
                            const newFiles = Array.from(e.target.files ?? [])

                            try {
                                validateImageFiles(newFiles)
                            } catch (error) {
                                const fileName = error instanceof UnsupportedImageFormatError
                                    ? error.fileName
                                    : ""
                                setError(
                                    a.errors.unsupportedImageFormat.replace(
                                        "{{file}}",
                                        fileName
                                    )
                                )
                                e.currentTarget.value = ""
                                return
                            }

                            if (imageFiles.length + newFiles.length > MAX_AD_IMAGES) {
                                setError(
                                    a.errors.maxImages.replace(
                                        "{{limit}}",
                                        String(MAX_AD_IMAGES)
                                    )
                                )
                                e.currentTarget.value = ""
                                return
                            }

                            setError(null)
                            setImageFiles((prev) => [...prev, ...newFiles])

                            // важно: чтобы можно было выбрать те же файлы ещё раз
                            e.currentTarget.value = ""
                        }}
                    />
                </div>
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
                        {imagePreviews.map((url, index) => (
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
                            ))}
                    </div>
                )}


                {error && (
                    <div style={{color: "#b91c1c", fontSize: "14px"}}>
                        {error}
                    </div>
                )}
                <div className="card stack12">
                    <strong>{a.promotion.title}</strong>
                    <Link
                        to="/promotion-info"
                        style={{fontSize: 13, color: "#2563eb", width: "fit-content"}}
                    >
                        {t.promotionInfo.linkLabel}
                    </Link>

                    {promotion !== 'none' && (
                        <div className="card stack12">
                            <strong>{a.payment.title}</strong>

                            {!isFormValid && (
                                <div>{a.payment.fillBeforePay}</div>
                            )}

                            {isFormValid && (
                                <>
                                    <div style={{fontSize: 13, color: "#6b7280"}}>
                                        {a.payment.queueInfo}
                                    </div>

                                    <div style={{fontSize: 16}}>
                                        {a.payment.amount}:{" "}
                                        <strong>
                                            {promotion === "highlight-gold"
                                                ? PRICES.ad.gold
                                                : PRICES.ad[promotion]} PLN
                                        </strong>
                                    </div>

                                    {paymentCompleted ? (
                                        <div style={{
                                            padding: 12,
                                            borderRadius: 8,
                                            border: "1px solid #16a34a",
                                            background: "#ecfdf5",
                                            color: "#166534",
                                            fontSize: 14,
                                        }}>
                                            <div style={{fontWeight: 600, marginBottom: 4}}>
                                                {paymentSuccessTitle}
                                            </div>
                                            <div>{paymentSuccessMessage}</div>
                                        </div>
                                    ) : (
                                        <PayPalCheckoutButton
                                            amountPLN={
                                                promotion === "highlight-gold"
                                                    ? PRICES.ad.gold
                                                    : PRICES.ad[promotion]
                                            }
                                            description="Ozen Board - ad promotion"
                                            disabled={isPaying}
                                            paymentCompleted={paymentCompleted}
                                            orderId={paypalOrderId}
                                            onApprove={async (orderId) => {
                                                setError(null)
                                                setIsPaying(true)

                                                try {
                                                    await assertUserNotBlocked(userId)
                                                    const paymentResult = await verifyPayPalPayment({
                                                        orderId,
                                                        targetType: "ad",
                                                        promotionType: promotion,
                                                    })

                                                    if (!paymentResult.data?.ok) {
                                                        throw new Error(a.errors.paymentNotConfirmed)
                                                    }

                                                    setPaypalOrderId(orderId)
                                                    setPaymentCompleted(true)
                                                    setError(null)
                                                    sessionStorage.setItem(
                                                        PAYMENT_STORAGE_KEY,
                                                        JSON.stringify({
                                                            orderId,
                                                            promotion,
                                                        })
                                                    )
                                                } catch (error) {
                                                    setError(isAccountRestrictedError(error) ? t.common.accountRestricted : a.errors.paymentNotConfirmed)
                                                    throw error
                                                } finally {
                                                    setIsPaying(false)
                                                }
                                            }}
                                            onError={(message) => {
                                                if (paymentCompleted || paypalOrderId) return
                                                setIsPaying(false)
                                                setError(message)
                                            }}
                                        />
                                    )}
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
                            disabled={paymentCompleted || isPaying}
                        />
                        🆓 {a.promotion.none}
                        <div className="hint">{a.promotion.noneHint}
                        </div>
                    </label>

                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === 'top3'}
                            onChange={() => setPromotion('top3')}
                            disabled={pinLoading || paymentCompleted || isPaying}
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
                            disabled={pinLoading || paymentCompleted || isPaying}
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
                            disabled={paymentCompleted || isPaying}
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
                            disabled={paymentCompleted || isPaying}
                        />
                        ✨ {a.promotion.gold}
                        <div className="hint">{a.promotion.goldHint}</div>

                    </label>
                </div>


                <button
                    type="submit"
                    className="btn-primary"
                    disabled={
                        isSubmitting ||
                        isPaying ||
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
