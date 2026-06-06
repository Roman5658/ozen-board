import { useEffect, useMemo, useState } from "react"
import { collection, getDocs, writeBatch, doc, updateDoc } from "firebase/firestore"
import { Link } from "react-router-dom"

import { db } from "../app/firebase"
import type { Ad } from "../types/ad"
import { getLocalUser } from "../data/localUser"
import { buildAdPath } from "../utils/slug"
import AdminPagination, { getAdminPaginationLabels, paginateItems } from "../components/AdminPagination"

const PAGE_SIZE = 30

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
    const paginationLabels = getAdminPaginationLabels(lang)
    const text = lang === "pl"
        ? {
            searchPlaceholder: "Szukaj ogłoszeń",
            noResults: "Nie znaleziono ogłoszeń",
            open: "Otwórz",
            filters: {
                city: "Miasto",
                allCities: "Wszystkie miasta",
                voivodeship: "Województwo",
                allVoivodeships: "Wszystkie województwa",
                category: "Kategoria",
                allCategories: "Wszystkie kategorie",
                status: "Status",
                allStatuses: "Wszystkie statusy",
            },
            categories: {
                work: "Praca",
                sell: "Sprzedam",
                buy: "Kupię",
                service: "Usługi",
                rent: "Wynajem",
            } as Record<string, string>,
        }
        : {
            searchPlaceholder: "Пошук оголошень",
            noResults: "Оголошень не знайдено",
            open: "Відкрити",
            filters: {
                city: "Місто",
                allCities: "Усі міста",
                voivodeship: "Воєводство",
                allVoivodeships: "Усі воєводства",
                category: "Категорія",
                allCategories: "Усі категорії",
                status: "Статус",
                allStatuses: "Усі статуси",
            },
            categories: {
                work: "Робота",
                sell: "Продам",
                buy: "Куплю",
                service: "Послуги",
                rent: "Оренда",
            } as Record<string, string>,
        }
    const [ads, setAds] = useState<Ad[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [cityFilter, setCityFilter] = useState("all")
    const [voivodeshipFilter, setVoivodeshipFilter] = useState("all")
    const [categoryFilter, setCategoryFilter] = useState("all")
    const [statusFilter, setStatusFilter] = useState("all")
    const [page, setPage] = useState(1)
    const [now, setNow] = useState(() => Date.now())

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

    async function markAdRead(adId: string) {
        const ad = ads.find(item => item.id === adId)
        if (!ad || ad.adminViewedAt) return

        const adminViewedAt = Date.now()
        const adminViewedBy = getAdminActorId()
        try {
            await updateDoc(doc(db, "ads", adId), { adminViewedAt, adminViewedBy })
            setAds(current => current.map(item =>
                item.id === adId ? { ...item, adminViewedAt, adminViewedBy } : item
            ))
        } catch (error) {
            console.error("[admin ads] failed to persist viewed state", error)
        }
    }

    async function markAllAdsRead() {
        const unreadAds = ads.filter(ad => !ad.adminViewedAt)
        if (unreadAds.length === 0) return

        const adminViewedAt = Date.now()
        const adminViewedBy = getAdminActorId()

        try {
            for (let index = 0; index < unreadAds.length; index += 450) {
                const batch = writeBatch(db)
                unreadAds.slice(index, index + 450).forEach(ad => {
                    batch.update(doc(db, "ads", ad.id), { adminViewedAt, adminViewedBy })
                })
                await batch.commit()
            }

            const unreadIds = new Set(unreadAds.map(ad => ad.id))
            setAds(current => current.map(ad =>
                unreadIds.has(ad.id) ? { ...ad, adminViewedAt, adminViewedBy } : ad
            ))
        } catch (error) {
            console.error("[admin ads] failed to mark all ads as viewed", error)
            alert("Не вдалося зберегти стан перегляду оголошень")
        }
    }

    const cityOptions = useMemo(
        () => Array.from(new Set(ads.map(ad => ad.city).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
        [ads]
    )

    const voivodeshipOptions = useMemo(
        () => Array.from(new Set(ads.map(ad => ad.voivodeship).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
        [ads]
    )

    const categoryOptions = useMemo(
        () => Array.from(new Set(ads.map(ad => ad.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
        [ads]
    )

    const statusOptions = useMemo(
        () => Array.from(new Set(ads.map(ad => ad.status ?? "active").filter(Boolean))).sort((a, b) => a.localeCompare(b)),
        [ads]
    )

    const filteredAds = useMemo(() => {
        const q = search.trim().toLowerCase()
        const base = ads
            .filter(ad => cityFilter === "all" || ad.city === cityFilter)
            .filter(ad => voivodeshipFilter === "all" || ad.voivodeship === voivodeshipFilter)
            .filter(ad => categoryFilter === "all" || ad.category === categoryFilter)
            .filter(ad => statusFilter === "all" || (ad.status ?? "active") === statusFilter)
            .filter(ad => !q || getSearchableText(ad).includes(q))
        return [...base].sort((a, b) => {
            const aNew = !a.adminViewedAt
            const bNew = !b.adminViewedAt
            if (aNew && !bNew) return -1
            if (!aNew && bNew) return 1
            return (b.createdAt ?? 0) - (a.createdAt ?? 0)
        })
    }, [ads, categoryFilter, cityFilter, search, statusFilter, voivodeshipFilter])

    const pagedAds = useMemo(
        () => paginateItems(filteredAds, page, PAGE_SIZE),
        [filteredAds, page]
    )

    useEffect(() => {
        setPage(1)
    }, [categoryFilter, cityFilter, search, statusFilter, voivodeshipFilter])

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
                <button className="btn-secondary" onClick={() => void markAllAdsRead()}>
                    Позначити всі прочитаними
                </button>
            )}

            {ads.length > 0 && (
                <div className="card" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                    <label className="stack8">
                        <span style={{ fontSize: 12, color: "#6b7280" }}>{text.filters.city}</span>
                        <select className="select" value={cityFilter} onChange={event => setCityFilter(event.target.value)}>
                            <option value="all">{text.filters.allCities}</option>
                            {cityOptions.map(city => <option key={city} value={city}>{city}</option>)}
                        </select>
                    </label>

                    <label className="stack8">
                        <span style={{ fontSize: 12, color: "#6b7280" }}>{text.filters.voivodeship}</span>
                        <select className="select" value={voivodeshipFilter} onChange={event => setVoivodeshipFilter(event.target.value)}>
                            <option value="all">{text.filters.allVoivodeships}</option>
                            {voivodeshipOptions.map(voivodeship => <option key={voivodeship} value={voivodeship}>{voivodeship}</option>)}
                        </select>
                    </label>

                    <label className="stack8">
                        <span style={{ fontSize: 12, color: "#6b7280" }}>{text.filters.category}</span>
                        <select className="select" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>
                            <option value="all">{text.filters.allCategories}</option>
                            {categoryOptions.map(category => (
                                <option key={category} value={category}>{text.categories[category] ?? category}</option>
                            ))}
                        </select>
                    </label>

                    <label className="stack8">
                        <span style={{ fontSize: 12, color: "#6b7280" }}>{text.filters.status}</span>
                        <select className="select" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                            <option value="all">{text.filters.allStatuses}</option>
                            {statusOptions.map(status => <option key={status} value={status}>{status}</option>)}
                        </select>
                    </label>

                    <label className="stack8">
                        <span style={{ fontSize: 12, color: "#6b7280" }}>{text.searchPlaceholder}</span>
                        <input
                            className="input"
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                            placeholder={text.searchPlaceholder}
                        />
                    </label>
                </div>
            )}

            {ads.length === 0 && (
                <div className="card">Оголошень немає</div>
            )}

            {ads.length > 0 && filteredAds.length === 0 && (
                <div className="card">{text.noResults}</div>
            )}

            {ads.length > 0 && filteredAds.length > 0 && (
                <AdminPagination
                    page={page}
                    pageSize={PAGE_SIZE}
                    totalItems={filteredAds.length}
                    labels={paginationLabels}
                    onPageChange={setPage}
                />
            )}

            {pagedAds.map(ad => {
                const inTop = ad.pinnedUntil && ad.pinnedUntil > now
                const inQueue = !inTop && ad.pinQueueAt
                const isNew = !ad.adminViewedAt

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
                                onClick={() => void markAdRead(ad.id)}
                                style={{ fontWeight: 700 }}
                            >
                                {ad.title}
                            </Link>
                            {isNew && (
                                <span className="listing-badge" style={{ background: "#f59e0b", color: "#111827" }}>
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
                                    onClick={() => void markAdRead(ad.id)}
                                    style={{ width: "fit-content" }}
                                >
                                    Позначити прочитаним
                                </button>
                            )}

                            <Link
                                className="btn-secondary"
                                to={buildAdPath(ad.title, ad.city, ad.id)}
                                onClick={() => void markAdRead(ad.id)}
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

            {ads.length > 0 && filteredAds.length > PAGE_SIZE && (
                <AdminPagination
                    page={page}
                    pageSize={PAGE_SIZE}
                    totalItems={filteredAds.length}
                    labels={paginationLabels}
                    onPageChange={setPage}
                />
            )}
        </div>
    )
}

export default AdminAdsListPage
