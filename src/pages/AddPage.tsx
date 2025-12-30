import { useState, useEffect } from "react"

import { useNavigate } from "react-router-dom"
import {
    addDoc,
    collection,
    getDocs,
    query,
    where,
} from "firebase/firestore"

import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import type { Ad } from "../types/ad"

import { db, storage } from "../app/firebase"
import { getLocalUser } from "../data/localUser"
import { addLocalAd } from "../data/localAds"
import { CITIES_BY_VOIVODESHIP } from "../data/cities"
import { checkPinAvailability } from "../data/pinAvailability"


type Category = "work" | "sell" | "buy" | "service" | "rent"
type VoivodeshipKey = keyof typeof CITIES_BY_VOIVODESHIP

function AddPage() {
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
        canTop5: boolean
        top3Used: number
        top5Used: number
    } | null>(null)

    const [pinLoading, setPinLoading] = useState(false)


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
                <h2>Спочатку увійдіть в акаунт</h2>
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
            setError("Заповніть всі обовʼязкові поля")
            return
        }

        if (imageFiles.length === 0) {
            setError("Додайте фото")
            return
        }

        const lastAdTime = localStorage.getItem("lastAdCreatedAt")

        if (lastAdTime) {
            const diff = Date.now() - Number(lastAdTime)

            if (diff < AD_COOLDOWN_MS) {
                setError(
                    `Зачекайте ${Math.ceil(
                        (AD_COOLDOWN_MS - diff) / 1000
                    )} сек перед створенням нового оголошення`
                )
                return
            }
        }




// лимит объявлений
        const MAX_ADS_PER_USER = 10

        const userAdsCount = await getDocs(
            query(
                collection(db, "ads"),
                where("userId", "==", userId)
            )
        )

        if (userAdsCount.size >= MAX_ADS_PER_USER) {
            setError("Досягнуто ліміт оголошень (10)")
            return
        }
// если выбрали PIN — перепроверяем лимит прямо перед созданием
        if ((promotion === 'top3' || promotion === 'top6') && city) {
            const info = await checkPinAvailability(city)

            if (
                (promotion === 'top3' && !info.canTop3) ||
                (promotion === 'top6' && !info.canTop5)
            ) {
                setError(`Закріплення у місті ${city} тимчасово недоступне`)
                return
            }
        }


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
                ...(location ? { location } : {}),

                // ===== платные опции (если выбраны) =====
                ...(promotion === 'bump'
                    ? { bumpAt: timestamp }
                    : {}),

                ...(promotion === 'top3'
                    ? {
                        pinType: 'top3',
                        pinnedAt: timestamp,
                        pinnedUntil: timestamp + 3 * 24 * 60 * 60 * 1000,
                    }
                    : {}),

                ...(promotion === 'top6'
                    ? {
                        pinType: 'top6',
                        pinnedAt: timestamp,
                        pinnedUntil: timestamp + 3 * 24 * 60 * 60 * 1000,
                    }
                    : {}),

                ...(promotion === 'highlight-gold'
                    ? {
                        highlightType: 'gold',
                        highlightUntil: timestamp + 7 * 24 * 60 * 60 * 1000,
                    }
                    : {}),

            }






            const docRef = await addDoc(collection(db, "ads"), adData)

            addLocalAd({
                id: docRef.id,
                ...adData,
            })
            setSellerContact("")

            navigate("/")
        } catch (err) {
            console.error(err)
            setError("Помилка при створенні оголошення")
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="card stack12">
            <h2 className="h2">Додати оголошення</h2>

            {/* 🔹 Переключатель режимов */}
            <div style={{display: "flex", gap: 8}}>
                <button
                    type="button"
                    className="btn-primary"
                    disabled
                >
                    Оголошення
                </button>

                <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => navigate("/add-auction")}
                >
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

                <select
                    className="input"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as Category)}
                >
                    <option value="">Категорія</option>
                    <option value="work">Робота</option>
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
                    <select
                        className="input"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                    >
                        <option value="">Місто</option>
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
                    placeholder="Ціна"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                />
                <input
                    className="input"
                    placeholder="Контакт (телефон / Telegram) — необовʼязково"
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
                            setError("Максимум 5 фото")
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
                    <strong>Просування оголошення</strong>

                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === 'none'}
                            onChange={() => setPromotion('none')}
                        />
                        🆓 Без просування
                        <div className="hint">Звичайне розміщення</div>
                    </label>

                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === 'top3'}
                            onChange={() => setPromotion('top3')}
                            disabled={pinLoading || (pinInfo ? !pinInfo.canTop3 : false)}
                        />
                        🔥 TOP 3
                        <div className="hint">Найвище місце у місті (обмежено)</div>
                    </label>

                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === 'top6'}
                            onChange={() => setPromotion('top6')}
                            disabled={pinLoading || (pinInfo ? !pinInfo.canTop5 : false)}
                        />
                        ⭐ TOP 6
                        <div className="hint">Після TOP 3</div>
                    </label>

                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === 'bump'}
                            onChange={() => setPromotion('bump')}
                        />
                        🚀 Підняти
                        <div className="hint">Разове підняття вгору</div>
                    </label>

                    <label className="promotion-option">
                        <input
                            type="radio"
                            name="promotion"
                            checked={promotion === 'highlight-gold'}
                            onChange={() => setPromotion('highlight-gold')}
                        />
                        ✨ Виділити (gold)
                        <div className="hint">Виділення кольором</div>
                    </label>
                </div>


                <button className="btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? "Завантаження..." : "Створити"}
                </button>
            </form>
        </div>
    )
}

export default AddPage
