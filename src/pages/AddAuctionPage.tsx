import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import { collection, addDoc } from "firebase/firestore"

import { db, storage } from "../app/firebase"
import { getLocalUser } from "../data/localUser"
import { CITIES_BY_VOIVODESHIP } from "../data/cities"

type Category = "sell" | "buy" | "service" | "rent"
type VoivodeshipKey = keyof typeof CITIES_BY_VOIVODESHIP

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
    const [imageFile, setImageFile] = useState<File | null>(null)
    const [endsAtDate, setEndsAtDate] = useState("")

    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    // ===== AUTH =====
    const user = getLocalUser()

    if (!user) {
        return (
            <div className="card">
                <h2>Спочатку увійдіть в акаунт</h2>
            </div>
        )
    }

    const safeUser = user

    // ===== SUBMIT =====
    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)

        if (
            !title.trim() ||
            !description.trim() ||
            !category ||
            !voivodeship ||
            !city ||
            !startPrice ||
            !imageFile ||
            !endsAtDate
        ) {
            setError("Заповніть всі обовʼязкові поля")
            return
        }

        const createdAt = Date.now()
        const endsAt = new Date(endsAtDate).getTime()

        const maxEndsAt = createdAt + 10 * 24 * 60 * 60 * 1000

        if (endsAt <= createdAt) {
            setError("Дата завершення має бути пізніше сьогодні")
            return
        }

        if (endsAt > maxEndsAt) {
            setError("Аукціон може тривати максимум 10 днів")
            return
        }

        try {
            setIsSubmitting(true)

            // upload image
            const imageRef = ref(
                storage,
                `auctions/${safeUser.id}/${createdAt}-${imageFile.name}`
            )

            await uploadBytes(imageRef, imageFile)
            const imageUrl = await getDownloadURL(imageRef)

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

                images: [imageUrl],

                ownerId: safeUser.id,
                ownerName: safeUser.nickname,

                status: "active",

                createdAt,
                endsAt,
            })

            navigate("/")
        } catch (err) {
            console.error(err)
            setError("Помилка при створенні аукціону")
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
                <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => navigate("/add")}
                >
                    Оголошення
                </button>

                <button
                    type="button"
                    className="btn-primary"
                    disabled
                >
                    Аукціон
                </button>
            </div>

            <form className="stack12" onSubmit={handleSubmit}>
                <input
                    className="input"
                    placeholder="Заголовок"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                />

                <textarea
                    className="input"
                    placeholder="Опис"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                />

                <select
                    className="input"
                    value={category}
                    onChange={e => setCategory(e.target.value as Category)}
                >
                    <option value="">Категорія</option>
                    <option value="sell">Продам</option>
                    <option value="buy">Куплю</option>
                    <option value="service">Послуги</option>
                    <option value="rent">Оренда</option>
                </select>

                <select
                    className="input"
                    value={voivodeship}
                    onChange={e => {
                        setVoivodeship(e.target.value)
                        setCity("")
                    }}
                >
                    <option value="">Воєводство</option>
                    {Object.keys(CITIES_BY_VOIVODESHIP).map(v => (
                        <option key={v} value={v}>
                            {v}
                        </option>
                    ))}
                </select>

                {voivodeship && (
                    <select
                        className="input"
                        value={city}
                        onChange={e => setCity(e.target.value)}
                    >
                        <option value="">Місто</option>
                        {(CITIES_BY_VOIVODESHIP[voivodeship as VoivodeshipKey] ?? []).map(
                            c => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            )
                        )}
                    </select>
                )}

                <input
                    className="input"
                    type="number"
                    placeholder="Стартова ціна"
                    value={startPrice}
                    onChange={e => setStartPrice(e.target.value)}
                />

                <input
                    className="input"
                    type="number"
                    placeholder="Купити зараз (необовʼязково)"
                    value={buyNowPrice}
                    onChange={e => setBuyNowPrice(e.target.value)}
                />

                <input
                    className="input"
                    type="date"
                    value={endsAtDate}
                    onChange={e => setEndsAtDate(e.target.value)}
                />

                <div style={{ fontSize: "13px", color: "#6b7280" }}>
                    Максимум 10 днів від сьогодні
                </div>

                <input
                    type="file"
                    accept="image/*"
                    onChange={e =>
                        setImageFile(e.target.files ? e.target.files[0] : null)
                    }
                />

                {error && <div style={{ color: "#b91c1c" }}>{error}</div>}

                <button className="btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? "Завантаження..." : "Створити аукціон"}
                </button>
            </form>
        </div>
    )
}

export default AddAuctionPage
