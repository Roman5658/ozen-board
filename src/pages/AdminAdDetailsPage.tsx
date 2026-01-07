import { useEffect, useState } from "react"
import { doc, getDoc } from "firebase/firestore"
import { useParams, Link } from "react-router-dom"
import { updateDoc } from "firebase/firestore"

import { db } from "../app/firebase"
import type { Ad } from "../types/ad"

function formatDate(ts?: number) {
    if (!ts) return "—"
    return new Date(ts).toLocaleString()
}

function AdminAdDetailsPage() {
    const { adId } = useParams<{ adId: string }>()
    const [ad, setAd] = useState<Ad | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function loadAd() {
            if (!adId) return

            const ref = doc(db, "ads", adId)
            const snap = await getDoc(ref)

            if (snap.exists()) {
                setAd({
                    id: snap.id,
                    ...(snap.data() as Omit<Ad, "id">),
                })
            } else {
                setAd(null)
            }

            setLoading(false)
        }

        loadAd()
    }, [adId])

    if (loading) {
        return <div className="card">Завантаження…</div>
    }

    if (!ad) {
        return (
            <div className="stack12">
                <div className="card">Оголошення не знайдено</div>
                <Link to="/admin/ads">← Назад</Link>
            </div>
        )
    }
    const DAY = 24 * 60 * 60 * 1000

    async function setTop(type: "top3" | "top6") {
        if (!ad) return
        const now = Date.now()

        await updateDoc(doc(db, "ads", ad.id), {
            pinType: type,
            pinnedAt: now,
            pinnedUntil: now + 3 * DAY,
            pinQueueAt: null,
        })

        setAd({
            ...ad,
            pinType: type,
            pinnedAt: now,
            pinnedUntil: now + 3 * DAY,
            pinQueueAt: undefined,
        })
    }

    async function sendToQueue(type: "top3" | "top6") {
        if (!ad) return
        const now = Date.now()

        await updateDoc(doc(db, "ads", ad.id), {
            pinType: type,
            pinQueueAt: now,
            pinnedAt: null,
            pinnedUntil: null,
        })

        setAd({
            ...ad,
            pinType: type,
            pinQueueAt: now,
            pinnedAt: undefined,
            pinnedUntil: undefined,
        })
    }

    async function clearPromotion() {
        if (!ad) return

        await updateDoc(doc(db, "ads", ad.id), {
            pinType: null,
            pinnedAt: null,
            pinnedUntil: null,
            pinQueueAt: null,
        })

        setAd({
            ...ad,
            pinType: undefined,
            pinnedAt: undefined,
            pinnedUntil: undefined,
            pinQueueAt: undefined,
        })
    }

    async function softDelete() {
        if (!ad) return
        const ok = window.confirm("Помітити оголошення як видалене?")
        if (!ok) return

        await updateDoc(doc(db, "ads", ad.id), {
            status: "deleted",
        })

        setAd({
            ...ad,
            status: "deleted",
        })
    }

    const now = Date.now()

    const inTop =
        ad.pinnedUntil &&
        ad.pinnedUntil > now

    const inQueue =
        !inTop &&
        ad.pinQueueAt

    let promo = "—"
    if (inTop) promo = `TOP (${ad.pinType})`
    else if (inQueue) promo = `QUEUE (${ad.pinType})`

    return (
        <div className="stack12">
            <Link to="/admin/ads">← Назад</Link>

            <div className="card stack8">
                <h2 className="h2">{ad.title}</h2>

                <div style={{ fontSize: 12, color: "#6b7280" }}>
                    {ad.city} · {ad.voivodeship}
                </div>

                <hr />

                <div><b>ID:</b> {ad.id}</div>
                <div><b>Продавець (userId):</b> {ad.userId}</div>

                <hr />

                <div><b>Створено:</b> {formatDate(ad.createdAt)}</div>
                <div><b>Оплачено:</b> {formatDate(ad.paidAt)}</div>

                <hr />

                <div><b>Просування:</b> {promo}</div>
                <div><b>В черзі з:</b> {formatDate(ad.pinQueueAt)}</div>
                <div><b>В ТОП до:</b> {formatDate(ad.pinnedUntil)}</div>

                <hr />

                <div>
                    <b>Статус:</b>{" "}
                    <span style={{fontWeight: 700}}>
                        {ad.status ?? "active"}
                    </span>
                    <hr/>

                    <div style={{display: "flex", gap: 8, flexWrap: "wrap"}}>
                        <button className="btn-secondary" onClick={() => setTop("top3")}>
                            🔥 TOP 3
                        </button>

                        <button className="btn-secondary" onClick={() => setTop("top6")}>
                            🔥 TOP 6
                        </button>

                        <button className="btn-secondary" onClick={() => sendToQueue("top3")}>
                            ⏳ У чергу TOP 3
                        </button>

                        <button className="btn-secondary" onClick={() => sendToQueue("top6")}>
                            ⏳ У чергу TOP 6
                        </button>

                        <button className="btn-secondary" onClick={clearPromotion}>
                            ❌ Зняти просування
                        </button>

                        <button className="btn-danger" onClick={softDelete}>
                            🗑 Видалити
                        </button>
                    </div>

                </div>
            </div>
        </div>
    )
}

export default AdminAdDetailsPage
