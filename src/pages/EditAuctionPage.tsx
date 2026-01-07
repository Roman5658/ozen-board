import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { doc, getDoc, updateDoc } from "firebase/firestore"
import { db } from "../app/firebase"
import { getLocalUser } from "../data/localUser"
import { CITIES_BY_VOIVODESHIP } from "../data/cities"
import { canEditAuction } from "../utils/canEdit"
type VoivodeshipKey = keyof typeof CITIES_BY_VOIVODESHIP

function EditAuctionPage() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const user = getLocalUser()

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [auction, setAuction] = useState<any | null>(null)

    const [title, setTitle] = useState("")
    const [description, setDescription] = useState("")
    const [startPrice, setStartPrice] = useState("")
    const [buyNowPrice, setBuyNowPrice] = useState("")
    const [voivodeship, setVoivodeship] = useState("")
    const [city, setCity] = useState("")
    const [endsAtDate, setEndsAtDate] = useState("")

    const cityOptions = useMemo(() => {
        const key = voivodeship as VoivodeshipKey
        return [...(CITIES_BY_VOIVODESHIP[key] ?? [])]
    }, [voivodeship])

    useEffect(() => {
        async function load() {
            try {
                if (!id) {
                    setError("Немає id аукціону")
                    return
                }
                if (!user) {
                    setError("Спочатку увійдіть в акаунт")
                    return
                }

                const ref = doc(db, "auctions", id)
                const snap = await getDoc(ref)

                if (!snap.exists()) {
                    setError("Аукціон не знайдено")
                    return
                }

                const loaded = { id, ...snap.data() } as any

                if (loaded.ownerId !== user.id) {
                    setError("У вас немає прав редагувати цей аукціон")
                    return
                }

                if (!["draft", "active"].includes(loaded.status)) {
                    setError("Цей аукціон не можна редагувати")
                    return
                }


                if (!canEditAuction(loaded, user.id)) {
                    setError("Цей аукціон не можна редагувати")
                    return
                }


                setAuction(loaded)

                setTitle(loaded.title ?? "")
                setDescription(loaded.description ?? "")
                setStartPrice(String(loaded.startPrice ?? ""))
                setBuyNowPrice(loaded.buyNowPrice ? String(loaded.buyNowPrice) : "")
                setVoivodeship(loaded.voivodeship ?? "")
                setCity(loaded.city ?? "")
                setEndsAtDate(
                    loaded.endsAt
                        ? new Date(loaded.endsAt).toISOString().slice(0, 10)
                        : ""
                )
            } catch (e) {
                console.error(e)
                setError("Помилка завантаження аукціону")
            } finally {
                setLoading(false)
            }
        }

        load()
    }, [id])

    async function handleSave(e: React.FormEvent) {
        e.preventDefault()
        setError(null)

        if (!auction) return

        if (
            !title.trim() ||
            !description.trim() ||
            !startPrice ||
            !voivodeship ||
            !city ||
            !endsAtDate
        ) {
            setError("Заповніть усі обовʼязкові поля")
            return
        }

        const start = Number(startPrice)
        if (Number.isNaN(start)) {
            setError("Некоректна стартова ціна")
            return
        }

        const buyNow = buyNowPrice ? Number(buyNowPrice) : null
        if (buyNowPrice && Number.isNaN(buyNow)) {
            setError("Некоректна ціна «Купити зараз»")
            return
        }

        const endsAt = new Date(endsAtDate).getTime()
        if (Number.isNaN(endsAt) || endsAt <= Date.now()) {
            setError("Некоректна дата завершення")
            return
        }

        try {
            setSaving(true)

            await updateDoc(doc(db, "auctions", auction.id), {
                title: title.trim(),
                description: description.trim(),
                startPrice: start,
                buyNowPrice: buyNow,
                voivodeship,
                city,
                endsAt,
                updatedAt: Date.now(),
            })

            navigate(`/auction/${auction.id}`)
        } catch (e) {
            console.error(e)
            setError("Помилка збереження")
        } finally {
            setSaving(false)
        }
    }

    if (loading) return <div className="card">Завантаження…</div>

    if (error) {
        return (
            <div className="card stack12">
                <div style={{ color: "#b91c1c" }}>{error}</div>
                <button className="btn-secondary" onClick={() => navigate(-1)}>
                    ← Назад
                </button>
            </div>
        )
    }

    return (
        <div className="card stack12">
            <h2 className="h2">Редагування аукціону</h2>

            <form className="stack12" onSubmit={handleSave}>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
                <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} />

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
                        <option key={v} value={v}>{v}</option>
                    ))}
                </select>

                {voivodeship && (
                    <select className="input" value={city} onChange={(e) => setCity(e.target.value)}>
                        <option value="">Місто</option>
                        {cityOptions.map((c) => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                )}

                <input
                    className="input"
                    type="date"
                    value={endsAtDate}
                    onChange={(e) => setEndsAtDate(e.target.value)}
                />

                <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="btn-secondary" onClick={() => navigate(-1)} disabled={saving}>
                        Скасувати
                    </button>
                    <button className="btn-primary" disabled={saving}>
                        {saving ? "Збереження…" : "Зберегти"}
                    </button>
                </div>
            </form>
        </div>
    )
}

export default EditAuctionPage
