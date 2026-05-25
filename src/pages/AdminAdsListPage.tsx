import { useEffect, useState } from "react"
import { collection, getDocs, writeBatch, doc } from "firebase/firestore"
import { Link } from "react-router-dom"

import { db } from "../app/firebase"
import type { Ad } from "../types/ad"
import { getLocalUser } from "../data/localUser"

const ADMIN_READ_ADS_KEY = "xoven_admin_read_ads_v1"

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
    const [readAdIds, setReadAdIds] = useState<string[]>(() => {
        try {
            const raw = localStorage.getItem(ADMIN_READ_ADS_KEY)
            const parsed = raw ? JSON.parse(raw) : []
            return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
        } catch {
            return []
        }
    })

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

    function isAdRead(adId: string) {
        return readAdIds.includes(adId)
    }

    function saveReadAdIds(ids: string[]) {
        localStorage.setItem(ADMIN_READ_ADS_KEY, JSON.stringify(ids))
        setReadAdIds(ids)
    }

    function markAdRead(adId: string) {
        if (isAdRead(adId)) return
        saveReadAdIds([...readAdIds, adId])
    }

    function markAllAdsRead() {
        saveReadAdIds(Array.from(new Set([...readAdIds, ...ads.map(ad => ad.id)])))
    }

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
            {ads.length > 0 && (
                <button className="btn-secondary" onClick={markAllAdsRead}>
                    Позначити всі прочитаними
                </button>
            )}

            {ads.length === 0 && (
                <div className="card">Оголошень немає</div>
            )}

            {[...ads].sort((a, b) => {
                const aNew = !isAdRead(a.id)
                const bNew = !isAdRead(b.id)
                if (aNew && !bNew) return -1
                if (!aNew && bNew) return 1
                return (b.createdAt ?? 0) - (a.createdAt ?? 0)
            }).map(ad => {
                const now = Date.now()
                const inTop = ad.pinnedUntil && ad.pinnedUntil > now
                const inQueue = !inTop && ad.pinQueueAt
                const isNew = !isAdRead(ad.id)

                let promo = "—"
                if (inTop) promo = `TOP (${ad.pinType})`
                else if (inQueue) promo = `QUEUE (${ad.pinType})`

                return (
                    <div
                        key={ad.id}
                        className="card stack8"
                        style={{
                            border: isNew ? "2px solid #f59e0b" : "1px solid #e5e7eb",
                            background: isNew ? "#fffbeb" : "#fff",
                        }}
                    >
                        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                            <Link
                                to={`/admin/ads/${ad.id}`}
                                onClick={() => markAdRead(ad.id)}
                                style={{ fontWeight: 700 }}
                            >
                                {ad.title}
                            </Link>
                            {isNew && (
                                <span className="ad-badge" style={{ background: "#f59e0b", color: "#111827" }}>
                                    Нове
                                </span>
                            )}
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

                        {isNew && (
                            <button className="btn-secondary" onClick={() => markAdRead(ad.id)}>
                                Позначити прочитаним
                            </button>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

export default AdminAdsListPage
