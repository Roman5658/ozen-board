import { useEffect, useMemo, useState, type ReactNode } from "react"
import { collection, doc, getDocs, updateDoc } from "firebase/firestore"
import { Link } from "react-router-dom"


import { db } from "../app/firebase"
import type { Ad } from "../types/ad"
import { buildAdPath } from "../utils/slug"

type AdminAdSection = "activePromoted" | "queueTop"
type PromotionFilter = "all" | "top3" | "top6" | "highlight" | "bump" | "queue"
type AdminAdActions = {
    setTop: (ad: Ad) => Promise<void>
    setQueue: (ad: Ad) => Promise<void>
    clearTop: (ad: Ad) => Promise<void>
    clearQueue: (ad: Ad) => Promise<void>
}

const DAY = 24 * 60 * 60 * 1000
const ADMIN_TOP_DURATION = 3 * DAY

function formatDate(ts?: number | null) {
    if (!ts) return "—"
    return new Date(ts).toLocaleString()
}

function getAdOwnerLabel(ad: Ad) {
    return ad.userNickname?.trim() || ad.userName?.trim() || ad.userId || "—"
}

function isActiveAd(ad: Ad) {
    return ad.status === "active"
}

function isActiveTopAd(ad: Ad, now: number) {
    return (
        isActiveAd(ad) &&
        !!ad.pinType &&
        typeof ad.pinnedUntil === "number" &&
        ad.pinnedUntil > now
    )
}

function isQueuedTopAd(ad: Ad, now: number) {
    return (
        isActiveAd(ad) &&
        !!ad.pinType &&
        typeof ad.pinQueueAt === "number" &&
        (!ad.pinnedUntil || ad.pinnedUntil <= now)
    )
}

function isHighlightedAd(ad: Ad, now: number) {
    return (
        isActiveAd(ad) &&
        !!ad.highlightUntil &&
        ad.highlightUntil > now
    )
}

function isBumpedAd(ad: Ad) {
    return isActiveAd(ad) && typeof ad.bumpAt === "number"
}

function isActivePromotedAd(ad: Ad, now: number) {
    return (
        !isQueuedTopAd(ad, now) &&
        (isActiveTopAd(ad, now) || isHighlightedAd(ad, now) || isBumpedAd(ad))
    )
}

function renderAdItem(ad: Ad, section: AdminAdSection, now: number, actions: AdminAdActions, index?: number) {
    const isTopActive = isActiveTopAd(ad, now)
    const isHighlightActive = isHighlightedAd(ad, now)
    const isBumpActive = isBumpedAd(ad)
    const showSetTop = section === "queueTop" || (!isTopActive && section === "activePromoted")
    const showSetQueue = !isTopActive && section === "activePromoted"
    const showClearTop = isTopActive
    const showClearQueue = section === "queueTop"

    return (
        <div key={`${section}-${ad.id}`} className="card stack8">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                    <b>{typeof index === "number" ? `#${index + 1} — ` : ""}{ad.title}</b>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                        {ad.city} · {ad.voivodeship}
                    </div>
                </div>
            </div>

            <div style={{ fontSize: 12 }}>
                user: <b>{getAdOwnerLabel(ad)}</b>
            </div>
            <div style={{ fontSize: 12 }}>
                status: <b>{ad.status ?? "active"}</b>
            </div>

            {(isTopActive || section === "queueTop") && (
                <div style={{ fontSize: 12 }}>
                    pinType: <b>{ad.pinType}</b>
                </div>
            )}

            {isTopActive && (
                <>
                    <div style={{ fontSize: 12 }}>
                        pinnedUntil: <b>{formatDate(ad.pinnedUntil)}</b>
                    </div>
                    <div style={{ fontSize: 12 }}>
                        pinnedAt: <b>{formatDate(ad.pinnedAt)}</b>
                    </div>
                </>
            )}

            {section === "queueTop" && (
                <div style={{ fontSize: 12 }}>
                    pinQueueAt: <b>{formatDate(ad.pinQueueAt)}</b>
                </div>
            )}

            {isHighlightActive && (
                <>
                    <div style={{ fontSize: 12 }}>
                        highlightType: <b>{ad.highlightType ?? "gold"}</b>
                    </div>
                    <div style={{ fontSize: 12 }}>
                        highlightUntil: <b>{formatDate(ad.highlightUntil)}</b>
                    </div>
                </>
            )}

            {isBumpActive && (
                <div style={{ fontSize: 12 }}>
                    bumpAt: <b>{formatDate(ad.bumpAt)}</b>
                </div>
            )}

            {ad.paymentId && (
                <div style={{ fontSize: 12 }}>
                    paymentId: <code>{ad.paymentId}</code>
                </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {showSetTop && (
                    <button className="btn-secondary" type="button" onClick={() => void actions.setTop(ad)}>
                        Поставити в TOP
                    </button>
                )}

                {showSetQueue && (
                    <button className="btn-secondary" type="button" onClick={() => void actions.setQueue(ad)}>
                        Поставити в чергу TOP
                    </button>
                )}

                {showClearTop && (
                    <button className="btn-secondary" type="button" onClick={() => void actions.clearTop(ad)}>
                        Прибрати з TOP
                    </button>
                )}

                {showClearQueue && (
                    <button className="btn-secondary" type="button" onClick={() => void actions.clearQueue(ad)}>
                        Прибрати з черги
                    </button>
                )}

                <Link className="btn-secondary" to={buildAdPath(ad.title, ad.city, ad.id)}>
                    Відкрити оголошення
                </Link>
            </div>
        </div>
    )
}

function renderSection(title: string, emptyText: string, children: ReactNode, count: number) {
    return (
        <section className="stack8">
            <h3>{title}</h3>
            {count === 0 ? (
                <div className="card" style={{ color: "#6b7280", fontSize: 14 }}>
                    {emptyText}
                </div>
            ) : (
                children
            )}
        </section>
    )
}

function AdminAdsPage() {
    const [ads, setAds] = useState<Ad[]>([])
    const [loading, setLoading] = useState(true)
    const [cityFilter, setCityFilter] = useState("all")
    const [voivodeshipFilter, setVoivodeshipFilter] = useState("all")
    const [promotionFilter, setPromotionFilter] = useState<PromotionFilter>("all")
    const [now, setNow] = useState(() => Date.now())

    // -------------------------
    // загрузка объявлений
    // -------------------------
    useEffect(() => {
        async function loadAds() {
            const snap = await getDocs(collection(db, "ads"))

            const data: Ad[] = snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as Omit<Ad, "id">),
            }))

            setAds(data)
            setNow(Date.now())
            setLoading(false)
        }

        loadAds()
    }, [])

    // -------------------------
    // действия администратора
    // -------------------------

    async function setTop(ad: Ad) {
        const actionNow = now
        const pinnedUntil = actionNow + ADMIN_TOP_DURATION

        try {
            await updateDoc(doc(db, "ads", ad.id), {
                status: "active",
                pinType: "top3",
                pinnedAt: actionNow,
                pinnedUntil,
                pinQueueAt: null,
            })

            setAds(prev =>
                prev.map(item =>
                    item.id === ad.id
                        ? {
                            ...item,
                            status: "active",
                            pinType: "top3",
                            pinnedAt: actionNow,
                            pinnedUntil,
                            pinQueueAt: undefined,
                        }
                        : item
                )
            )
            alert("Оголошення додано в TOP")
        } catch (error) {
            console.error(error)
            alert("Не вдалося додати оголошення в TOP")
        }
    }

    async function setQueue(ad: Ad) {
        const actionNow = now

        try {
            await updateDoc(doc(db, "ads", ad.id), {
                status: "active",
                pinType: "top3",
                pinnedAt: null,
                pinnedUntil: null,
                pinQueueAt: actionNow,
            })

            setAds(prev =>
                prev.map(item =>
                    item.id === ad.id
                        ? {
                            ...item,
                            status: "active",
                            pinType: "top3",
                            pinnedAt: undefined,
                            pinnedUntil: undefined,
                            pinQueueAt: actionNow,
                        }
                        : item
                )
            )
            alert("Оголошення додано в чергу TOP")
        } catch (error) {
            console.error(error)
            alert("Не вдалося додати оголошення в чергу TOP")
        }
    }

    async function clearTop(ad: Ad) {
        const ok = window.confirm(`Прибрати "${ad.title}" з TOP?`)
        if (!ok) return

        try {
            await updateDoc(doc(db, "ads", ad.id), {
                pinType: null,
                pinnedAt: null,
                pinnedUntil: null,
                pinQueueAt: null,
            })

            setAds(prev =>
                prev.map(item =>
                    item.id === ad.id
                        ? {
                            ...item,
                            pinType: undefined,
                            pinnedAt: undefined,
                            pinnedUntil: undefined,
                            pinQueueAt: undefined,
                        }
                        : item
                )
            )
            alert("TOP знято")
        } catch (error) {
            console.error(error)
            alert("Не вдалося зняти TOP")
        }
    }

    async function clearQueue(ad: Ad) {
        const ok = window.confirm(`Прибрати "${ad.title}" з черги TOP?`)
        if (!ok) return

        try {
            await updateDoc(doc(db, "ads", ad.id), {
                pinType: null,
                pinnedAt: null,
                pinnedUntil: null,
                pinQueueAt: null,
            })

            setAds(prev =>
                prev.map(item =>
                    item.id === ad.id
                        ? {
                            ...item,
                            pinType: undefined,
                            pinnedAt: undefined,
                            pinnedUntil: undefined,
                            pinQueueAt: undefined,
                        }
                        : item
                )
            )
            alert("Оголошення прибрано з черги")
        } catch (error) {
            console.error(error)
            alert("Не вдалося прибрати оголошення з черги")
        }
    }

    // -------------------------
    // UI
    // -------------------------

    const cityOptions = useMemo(
        () => Array.from(new Set(ads.map(ad => ad.city).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
        [ads]
    )

    const voivodeshipOptions = useMemo(
        () => Array.from(new Set(ads.map(ad => ad.voivodeship).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
        [ads]
    )

    const activePromotedAds = useMemo(() => {
        function matchesLocationFilters(ad: Ad) {
            if (cityFilter !== "all" && ad.city !== cityFilter) return false
            if (voivodeshipFilter !== "all" && ad.voivodeship !== voivodeshipFilter) return false
            return true
        }

        function matchesPromotionFilter(ad: Ad, section: AdminAdSection) {
            if (promotionFilter === "all") return true
            if (promotionFilter === "queue") return section === "queueTop"
            if (promotionFilter === "top3") return ad.pinType === "top3"
            if (promotionFilter === "top6") return ad.pinType === "top6"
            if (promotionFilter === "highlight") return section === "activePromoted" && isHighlightedAd(ad, now)
            if (promotionFilter === "bump") return section === "activePromoted" && isBumpedAd(ad)
            return true
        }

        function getActivePromotionRank(ad: Ad) {
            if (ad.pinType === "top3" && isActiveTopAd(ad, now)) return 0
            if (ad.pinType === "top6" && isActiveTopAd(ad, now)) return 1
            if (isHighlightedAd(ad, now)) return 2
            if (isBumpedAd(ad)) return 3
            return 4
        }

        function getActivePromotionDate(ad: Ad) {
            if (isActiveTopAd(ad, now)) return ad.pinnedUntil ?? 0
            if (isHighlightedAd(ad, now)) return ad.highlightUntil ?? 0
            return ad.bumpAt ?? 0
        }

        return ads
            .filter(ad => isActivePromotedAd(ad, now))
            .filter(matchesLocationFilters)
            .filter(ad => matchesPromotionFilter(ad, "activePromoted"))
            .sort((a, b) => {
                const rankDiff = getActivePromotionRank(a) - getActivePromotionRank(b)
                if (rankDiff !== 0) return rankDiff
                return getActivePromotionDate(a) - getActivePromotionDate(b)
            })
    }, [ads, cityFilter, now, promotionFilter, voivodeshipFilter])

    const activePromotedIds = useMemo(
        () => new Set(activePromotedAds.map(ad => ad.id)),
        [activePromotedAds]
    )

    const queuedTopAds = useMemo(() => {
        function matchesLocationFilters(ad: Ad) {
            if (cityFilter !== "all" && ad.city !== cityFilter) return false
            if (voivodeshipFilter !== "all" && ad.voivodeship !== voivodeshipFilter) return false
            return true
        }

        function matchesPromotionFilter(ad: Ad, section: AdminAdSection) {
            if (promotionFilter === "all") return true
            if (promotionFilter === "queue") return section === "queueTop"
            if (promotionFilter === "top3") return ad.pinType === "top3"
            if (promotionFilter === "top6") return ad.pinType === "top6"
            if (promotionFilter === "highlight") return section === "activePromoted" && isHighlightedAd(ad, now)
            if (promotionFilter === "bump") return section === "activePromoted" && isBumpedAd(ad)
            return true
        }

        return ads
            .filter(ad => isQueuedTopAd(ad, now))
            .filter(ad => !activePromotedIds.has(ad.id))
            .filter(matchesLocationFilters)
            .filter(ad => matchesPromotionFilter(ad, "queueTop"))
            .sort((a, b) => (a.pinQueueAt ?? 0) - (b.pinQueueAt ?? 0))
    }, [activePromotedIds, ads, cityFilter, now, promotionFilter, voivodeshipFilter])

    const adminAdActions: AdminAdActions = {
        setTop,
        setQueue,
        clearTop,
        clearQueue,
    }

    if (loading) {
        return <div className="card">Завантаження…</div>
    }

    return (
        <div className="stack12">
            <h2 className="h2">Адмін · Оголошення</h2>

            <div className="card" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <label className="stack8">
                    <span style={{ fontSize: 12, color: "#6b7280" }}>Місто</span>
                    <select className="select" value={cityFilter} onChange={e => setCityFilter(e.target.value)}>
                        <option value="all">Усі міста</option>
                        {cityOptions.map(city => (
                            <option key={city} value={city}>{city}</option>
                        ))}
                    </select>
                </label>

                <label className="stack8">
                    <span style={{ fontSize: 12, color: "#6b7280" }}>Воєводство</span>
                    <select className="select" value={voivodeshipFilter} onChange={e => setVoivodeshipFilter(e.target.value)}>
                        <option value="all">Усі воєводства</option>
                        {voivodeshipOptions.map(voivodeship => (
                            <option key={voivodeship} value={voivodeship}>{voivodeship}</option>
                        ))}
                    </select>
                </label>

                <label className="stack8">
                    <span style={{ fontSize: 12, color: "#6b7280" }}>Тип просування</span>
                    <select
                        className="select"
                        value={promotionFilter}
                        onChange={e => setPromotionFilter(e.target.value as PromotionFilter)}
                    >
                        <option value="all">Усі типи</option>
                        <option value="top3">TOP 3</option>
                        <option value="top6">TOP 6</option>
                        <option value="highlight">Gold / Highlight</option>
                        <option value="bump">Bump</option>
                        <option value="queue">Черга TOP</option>
                    </select>
                </label>
            </div>

            {ads.length === 0 ? (
                <div className="card">Оголошень немає</div>
            ) : (
                <>
                    {renderSection(
                        "Активні promoted / TOP",
                        "Активних promoted оголошень немає",
                        activePromotedAds.map(ad => renderAdItem(ad, "activePromoted", now, adminAdActions)),
                        activePromotedAds.length
                    )}

                    {renderSection(
                        "Черга TOP",
                        "Черга TOP порожня",
                        queuedTopAds.map((ad, index) => renderAdItem(ad, "queueTop", now, adminAdActions, index)),
                        queuedTopAds.length
                    )}
                </>
            )}

            {/*{ads.map(ad => {*/}
            {/*    const isDeleted = ad.status === "deleted"*/}
            {/*    const isTop = ad.pinType === "top3" || ad.pinType === "top6"*/}

            {/*    return (*/}
            {/*        <div key={ad.id} className="card stack8">*/}
            {/*            <div style={{ fontWeight: 700 }}>*/}
            {/*                {ad.title}*/}
            {/*            </div>*/}

            {/*            <div style={{ fontSize: 12, color: "#6b7280" }}>*/}
            {/*                {ad.city} · {ad.voivodeship}*/}
            {/*            </div>*/}

            {/*            <div style={{ fontSize: 12 }}>*/}
            {/*                userId: {ad.userId}*/}
            {/*            </div>*/}

            {/*            <div style={{ fontSize: 12 }}>*/}
            {/*                status: <b>{ad.status ?? "active"}</b>*/}
            {/*            </div>*/}

            {/*            {ad.pinType && (*/}
            {/*                <div style={{ fontSize: 12 }}>*/}
            {/*                    TOP: {ad.pinType} до{" "}*/}
            {/*                    {ad.pinnedUntil*/}
            {/*                        ? new Date(ad.pinnedUntil).toLocaleString()*/}
            {/*                        : "—"}*/}
            {/*                </div>*/}
            {/*            )}*/}

            {/*            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>*/}
            {/*                <button*/}
            {/*                    className="btn-secondary"*/}
            {/*                    onClick={() => setTop(ad.id, "top3")}*/}
            {/*                    disabled={isDeleted}*/}
            {/*                >*/}
            {/*                    TOP 3*/}
            {/*                </button>*/}

            {/*                <button*/}
            {/*                    className="btn-secondary"*/}
            {/*                    onClick={() => setTop(ad.id, "top6")}*/}
            {/*                    disabled={isDeleted}*/}
            {/*                >*/}
            {/*                    TOP 6*/}
            {/*                </button>*/}

            {/*                <button*/}
            {/*                    className="btn-secondary"*/}
            {/*                    onClick={() => clearTop(ad.id)}*/}
            {/*                    disabled={!isTop}*/}
            {/*                >*/}
            {/*                    Зняти TOP*/}
            {/*                </button>*/}

            {/*                <button*/}
            {/*                    className="btn-danger"*/}
            {/*                    onClick={() => softDelete(ad.id)}*/}
            {/*                    disabled={isDeleted}*/}
            {/*                >*/}
            {/*                    Видалити*/}
            {/*                </button>*/}
            {/*            </div>*/}
            {/*        </div>*/}
            {/*    )*/}
            {/*})}*/}
        </div>
    )
}

export default AdminAdsPage
