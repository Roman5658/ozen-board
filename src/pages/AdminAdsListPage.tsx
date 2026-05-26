import { useEffect, useMemo, useState } from "react"
import { collection, getDocs, writeBatch, doc } from "firebase/firestore"
import { Link } from "react-router-dom"

import { db } from "../app/firebase"
import type { Ad } from "../types/ad"
import { getLocalUser } from "../data/localUser"
import { buildAdPath } from "../utils/slug"

const ADMIN_READ_ADS_KEY = "xoven_admin_read_ads_v1"

function formatDate(ts?: number) {
    if (!ts) return "—"
    return new Date(ts).toLocaleString()
}

function getAdminActorId() {
    const user = getLocalUser()
    return user?.uid || user?.id || user?.email || "admin"
}

function getSearchableText(ad: Ad) {
    const ownerId = (ad as Ad & { ownerId?: string }).ownerId
    return [
        ad.id,
        ad.title,
        ad.description,
        ad.city,
        ad.voivodeship,
        ad.userId,
        ownerId,
        ad.userNickname,
        ad.userName,
    ].filter(Boolean).join(" ").toLowerCase()
}

function AdminAdsListPage() {
    const lang = localStorage.getItem("lang") === "pl" ? "pl" : "uk"
    const text = lang === "pl"
        ? {
            searchPlaceholder: "Szukaj ogłoszeń",
            noResults: "Nie znaleziono ogłoszeń",
            open: "Otwórz",
        }
        : {
            searchPlaceholder: "Пошук оголошень",
            noResults: "Оголошень не знайдено",
            open: "Відкрити",
        }
    const [ads, setAds] = useState<Ad[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [now, setNow] = useState(() => Date.now())
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
            setNow(Date.now())
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

    const filteredAds = useMemo(() => {
        const q = search.trim().toLowerCase()
        const base = q ? ads.filter(ad => getSearchableText(ad).includes(q)) : ads
        const readIds = new Set(readAdIds)

        return [...base].sort((a, b) => {
            const aNew = !readIds.has(a.id)
            const bNew = !readIds.has(b.id)
            if (aNew && !bNew) return -1
            if (!aNew && bNew) return 1
            return (b.createdAt ?? 0) - (a.createdAt ?? 0)
        })
    }, [ads, readAdIds, search])

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

            {ads.length > 0 && (
                <input
                    className="input"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder={text.searchPlaceholder}
                    style={{ maxWidth: 520 }}
                />
            )}

            {ads.length === 0 && (
                <div className="card">Оголошень немає</div>
            )}

            {ads.length > 0 && filteredAds.length === 0 && (
                <div className="card">{text.noResults}</div>
            )}

            {filteredAds.map(ad => {
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

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                            {isNew && (
                                <button
                                    className="btn-secondary"
                                    onClick={() => markAdRead(ad.id)}
                                    style={{ width: "fit-content" }}
                                >
                                    Позначити прочитаним
                                </button>
                            )}

                            <Link
                                className="btn-secondary"
                                to={buildAdPath(ad.title, ad.city, ad.id)}
                                onClick={() => markAdRead(ad.id)}
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: "fit-content",
                                    maxWidth: "100%",
                                }}
                            >
                                {text.open}
                            </Link>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export default AdminAdsListPage
