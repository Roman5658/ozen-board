import { useEffect, useState } from "react"
import { collection, getDocs, writeBatch, doc } from "firebase/firestore"
import { Link } from "react-router-dom"

import { db } from "../app/firebase"
import type { Ad } from "../types/ad"
import { getLocalUser } from "../data/localUser"

function formatDate(ts?: number) {
    if (!ts) return "—"
    return new Date(ts).toLocaleString()
}

function getAdminActorId() {
    const user = getLocalUser()
    return user?.uid || user?.id || user?.email || "admin"
}

function AdminAdsListPage() {
    const [ads, setAds] = useState<Ad[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function loadAds() {
            const snap = await getDocs(collection(db, "ads"))

            const data: Ad[] = snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as Omit<Ad, "id">),
            }))

            data.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
            setAds(data)
            setLoading(false)
        }

        loadAds()
    }, [])

    // ✅ ВАЖНО: функция ВНУТРИ компонента
    async function removeAllAds() {
        const ok = window.confirm(
            "⚠ Ви впевнені, що хочете зняти ВСІ оголошення з публікації?"
        )
        if (!ok) return

        const reason = window.prompt("Вкажіть причину модерації")
        const moderationReason = reason?.trim()
        if (!moderationReason) {
            alert("Причина обов'язкова")
            return
        }

        const removedAt = Date.now()
        const removedBy = getAdminActorId()
        const snap = await getDocs(collection(db, "ads"))
        const batch = writeBatch(db)

        snap.docs.forEach(d => {
            batch.update(doc(db, "ads", d.id), {
                status: "removed",
                removedAt,
                removedBy,
                moderationReason,
            })
        })

        await batch.commit()

        setAds(prev =>
            prev.map(ad => ({
                ...ad,
                status: "removed",
                removedAt,
                removedBy,
                moderationReason,
            }))
        )
        alert("✅ Усі оголошення знято з публікації")
    }

    if (loading) {
        return <div className="card">Завантаження…</div>
    }

    return (
        <div className="stack12">
            <h2 className="h2">Адмін · Усі оголошення</h2>

            <button
                className="btn-danger"
                onClick={removeAllAds}
                style={{ marginBottom: 16 }}
            >
                Зняти ВСІ оголошення з публікації
            </button>

            {ads.length === 0 && (
                <div className="card">Оголошень немає</div>
            )}

            {ads.map(ad => {
                const now = Date.now()
                const inTop = ad.pinnedUntil && ad.pinnedUntil > now
                const inQueue = !inTop && ad.pinQueueAt

                let promo = "—"
                if (inTop) promo = `TOP (${ad.pinType})`
                else if (inQueue) promo = `QUEUE (${ad.pinType})`

                return (
                    <div key={ad.id} className="card stack8">
                        <div style={{ fontWeight: 700 }}>
                            <Link to={`/admin/ads/${ad.id}`}>
                                {ad.title}
                            </Link>
                        </div>

                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                            {ad.city} · {ad.voivodeship}
                        </div>

                        <div style={{ fontSize: 12 }}>
                            Створено: {formatDate(ad.createdAt)}
                        </div>

                        <div style={{ fontSize: 12 }}>
                            Просування: <b>{promo}</b>
                        </div>

                        {ad.pinnedUntil && (
                            <div style={{ fontSize: 12 }}>
                                До: {formatDate(ad.pinnedUntil)}
                            </div>
                        )}

                        <div style={{ fontSize: 12 }}>
                            Статус: <b>{ad.status ?? "active"}</b>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export default AdminAdsListPage
