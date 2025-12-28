import { useState } from "react"
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
    const [imageFile, setImageFile] = useState<File | null>(null)
    const [sellerContact, setSellerContact] = useState("")

    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

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

        if (!imageFile) {
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

        try {
            setIsSubmitting(true)
            const timestamp = Date.now()
            const location = await getCurrentLocation()


            // upload фото
            const imageRef = ref(
                storage,
                `ads/${userId}/${timestamp}-${imageFile.name}`
            )

            await uploadBytes(imageRef, imageFile)
            const imageUrl = await getDownloadURL(imageRef)

            const adData: Omit<Ad, "id"> = {
                title: title.trim(),
                description: description.trim(),
                category,
                voivodeship,
                city,
                price: price.trim(),
                image: imageUrl,
                userId,
                createdAt: timestamp,
                ...(location ? { location } : {}),
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
                    onChange={(e) =>
                        setImageFile(e.target.files ? e.target.files[0] : null)
                    }
                />

                {error && (
                    <div style={{color: "#b91c1c", fontSize: "14px"}}>
                        {error}
                    </div>
                )}

                <button className="btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? "Завантаження..." : "Створити"}
                </button>
            </form>
        </div>
    )
}

export default AddPage
