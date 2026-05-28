import { useEffect, useMemo, useState } from "react"
import {
    collection,
    getDocs,
    doc,
    updateDoc,
} from "firebase/firestore"


import { db } from "../app/firebase"
import type { Auction } from "../types/auction"
import { getLocalUser } from "../data/localUser"
import AdminPagination, { getAdminPaginationLabels, paginateItems } from "../components/AdminPagination"

const ADMIN_READ_AUCTIONS_KEY = "xoven_admin_read_auctions_v1"
const PAGE_SIZE = 30

function getAdminActorId() {
    const user = getLocalUser()
    return user?.uid || user?.id || user?.email || "admin"
}

function getAuctionPromotionUntil(auction: Auction) {
    return typeof auction.endsAt === "number" && auction.endsAt > Date.now()
        ? auction.endsAt
        : null
}

function getAuctionSearchText(auction: Auction) {
    return [
        auction.id,
        auction.title,
        auction.description,
        auction.city,
        auction.voivodeship,
        auction.ownerId,
        auction.ownerName,
        auction.ownerNickname,
        auction.status,
        auction.promotionType,
    ].filter(Boolean).join(" ").toLowerCase()
}

function AdminAuctionsPage() {
    const lang = localStorage.getItem("lang") === "pl" ? "pl" : "uk"
    const paginationLabels = getAdminPaginationLabels(lang)
    const text = lang === "pl"
        ? {
            searchPlaceholder: "Szukaj aukcji",
            noResults: "Nie znaleziono aukcji",
        }
        : {
            searchPlaceholder: "Пошук аукціонів",
            noResults: "Аукціонів не знайдено",
        }
    const [auctions, setAuctions] = useState<Auction[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [page, setPage] = useState(1)
    const [now, setNow] = useState(() => Date.now())
    const [readAuctionIds, setReadAuctionIds] = useState<string[]>(() => {
        try {
            const raw = localStorage.getItem(ADMIN_READ_AUCTIONS_KEY)
            const parsed = raw ? JSON.parse(raw) : []
            return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
        } catch {
            return []
        }
    })

    // =========================
    // LOAD AUCTIONS
    // =========================
    useEffect(() => {
        async function loadAuctions() {
            const snap = await getDocs(collection(db, "auctions"))

            const data: Auction[] = snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as Omit<Auction, "id">),
            }))

            setAuctions(data)
            setNow(Date.now())
            setLoading(false)
        }

        loadAuctions()
    }, [])

    function isAuctionRead(auctionId: string) {
        return readAuctionIds.includes(auctionId)
    }

    function saveReadAuctionIds(ids: string[]) {
        localStorage.setItem(ADMIN_READ_AUCTIONS_KEY, JSON.stringify(ids))
        setReadAuctionIds(ids)
    }

    function markAuctionRead(auctionId: string) {
        if (isAuctionRead(auctionId)) return
        saveReadAuctionIds([...readAuctionIds, auctionId])
    }

    function markAllAuctionsRead() {
        saveReadAuctionIds(Array.from(new Set([...readAuctionIds, ...auctions.map(a => a.id)])))
    }

    const filteredAuctions = useMemo(() => {
        const q = search.trim().toLowerCase()
        const readIds = new Set(readAuctionIds)

        return auctions
            .filter(auction => !q || getAuctionSearchText(auction).includes(q))
            .sort((a, b) => {
                const aNew = !readIds.has(a.id)
                const bNew = !readIds.has(b.id)
                if (aNew && !bNew) return -1
                if (!aNew && bNew) return 1
                return (b.createdAt ?? 0) - (a.createdAt ?? 0)
            })
    }, [auctions, readAuctionIds, search])

    const pagedAuctions = useMemo(
        () => paginateItems(filteredAuctions, page, PAGE_SIZE),
        [filteredAuctions, page]
    )

    useEffect(() => {
        setPage(1)
    }, [search])

    // =========================
    // ADMIN ACTIONS
    // =========================

    async function setTop(auction: Auction) {
        const promotionUntil = getAuctionPromotionUntil(auction)
        if (!promotionUntil) {
            alert("Аукціон уже завершено або немає дати завершення")
            return
        }

        await updateDoc(doc(db, "auctions", auction.id), {
            promotionType: "top-auction",
            promotionUntil,
            promotionQueueAt: null,
        })

        setAuctions(prev =>
            prev.map(a =>
                a.id === auction.id
                    ? {
                        ...a,
                        promotionType: "top-auction",
                        promotionUntil,
                        promotionQueueAt: null,
                    }
                    : a
            )
        )
    }


    async function setFeatured(auction: Auction) {
        const promotionUntil = getAuctionPromotionUntil(auction)
        if (!promotionUntil) {
            alert("Аукціон уже завершено або немає дати завершення")
            return
        }

        await updateDoc(doc(db, "auctions", auction.id), {
            promotionType: "featured",
            promotionUntil,
            promotionQueueAt: null,
        })

        setAuctions(prev =>
            prev.map(a =>
                a.id === auction.id
                    ? {
                        ...a,
                        promotionType: "featured",
                        promotionUntil,
                        promotionQueueAt: null,
                    }
                    : a
            )
        )
    }


    async function setGold(auction: Auction) {
        const promotionUntil = getAuctionPromotionUntil(auction)
        if (!promotionUntil) {
            alert("Аукціон уже завершено або немає дати завершення")
            return
        }

        await updateDoc(doc(db, "auctions", auction.id), {
            promotionType: "highlight-gold",
            promotionUntil,
            promotionQueueAt: null,
        })

        setAuctions(prev =>
            prev.map(a =>
                a.id === auction.id
                    ? {
                        ...a,
                        promotionType: "highlight-gold",
                        promotionUntil,
                        promotionQueueAt: null,
                    }
                    : a
            )
        )
    }


    async function clearPromotion(auctionId: string) {
        await updateDoc(doc(db, "auctions", auctionId), {
            promotionType: "none",
            promotionUntil: null,
            promotionQueueAt: null,
        })

        setAuctions(prev =>
            prev.map(a =>
                a.id === auctionId
                    ? {
                        ...a,
                        promotionType: "none",
                        promotionUntil: null,
                    }
                    : a
            )
        )
    }

    async function softDelete(auctionId: string) {
        const ok = window.confirm("Завершити аукціон?")
        if (!ok) return

        await updateDoc(doc(db, "auctions", auctionId), {
            status: "ended",
        })

        setAuctions(prev =>
            prev.map(a =>
                a.id === auctionId
                    ? { ...a, status: "ended" }
                    : a
            )
        )
    }

    async function removeAuction(auctionId: string) {
        const reason = window.prompt("Вкажіть причину зняття аукціону")
        const moderationReason = reason?.trim()
        if (!moderationReason) {
            alert("Причина обов'язкова")
            return
        }

        const removedAt = Date.now()
        const removedBy = getAdminActorId()

        await updateDoc(doc(db, "auctions", auctionId), {
            status: "removed",
            removedAt,
            removedBy,
            moderationReason,
        })

        setAuctions(prev =>
            prev.map(a =>
                a.id === auctionId
                    ? { ...a, status: "removed", removedAt, removedBy, moderationReason }
                    : a
            )
        )
    }

    // =========================
    // UI
    // =========================

    if (loading) {
        return <div className="card">Завантаження…</div>
    }

    return (
        <div className="stack12">
            <h2 className="h2">Адмін · Аукціони</h2>

            {auctions.length > 0 && (
                <button className="btn-secondary" onClick={markAllAuctionsRead}>
                    Позначити всі прочитаними
                </button>
            )}

            {auctions.length > 0 && (
                <input
                    className="input"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder={text.searchPlaceholder}
                    style={{ maxWidth: 520 }}
                />
            )}

            {auctions.length === 0 && (
                <div className="card">Аукціонів немає</div>
            )}

            {auctions.length > 0 && filteredAuctions.length === 0 && (
                <div className="card">{text.noResults}</div>
            )}

            {filteredAuctions.length > 0 && (
                <AdminPagination
                    page={page}
                    pageSize={PAGE_SIZE}
                    totalItems={filteredAuctions.length}
                    labels={paginationLabels}
                    onPageChange={setPage}
                />
            )}

            {pagedAuctions.map(a => {
                const isEnded = a.status === "ended"
                const isRemoved = a.status === "removed" || a.status === "deleted"
                const isNew = !isAuctionRead(a.id)
                const hasPromo =
                    a.promotionType !== "none" &&
                    a.promotionUntil &&
                    a.promotionUntil > now

                return (
                    <div
                        key={a.id}
                        className="card stack8"
                        style={{
                            border: isNew ? "2px solid #f59e0b" : "1px solid #e5e7eb",
                            background: isNew ? "#fffbeb" : "#fff",
                        }}
                    >
                        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                            <div style={{ fontWeight: 700 }}>{a.title}</div>
                            {isNew && (
                                <span className="listing-badge" style={{ background: "#f59e0b", color: "#111827" }}>
                                    Нове
                                </span>
                            )}
                        </div>

                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                            {a.city} · {a.voivodeship}
                        </div>

                        <div style={{ fontSize: 12 }}>
                            ownerId: {a.ownerId}
                        </div>

                        <div style={{ fontSize: 12 }}>
                            status: <b>{a.status}</b>
                        </div>

                        {hasPromo && (
                            <div style={{ fontSize: 12 }}>
                                PROMO: {a.promotionType} до{" "}
                                {new Date(a.promotionUntil!).toLocaleString()}
                            </div>
                        )}

                        <div style={{display: "flex", gap: 8, flexWrap: "wrap"}}>
                            {isNew && (
                                <button
                                    className="btn-secondary"
                                    onClick={() => markAuctionRead(a.id)}
                                >
                                    Позначити прочитаним
                                </button>
                            )}
                            <button
                                className="btn-secondary"
                                onClick={() => setTop(a)}
                                disabled={isEnded}
                            >
                                🔥 TOP
                            </button>
                            <button
                                className="btn-danger"
                                onClick={() => removeAuction(a.id)}
                                disabled={isRemoved}
                            >
                                Зняти з публікації
                            </button>

                            <button
                                className="btn-secondary"
                                onClick={() => setFeatured(a)}
                                disabled={isEnded}
                            >
                                ⭐ FEATURED
                            </button>

                            <button
                                className="btn-secondary"
                                onClick={() => setGold(a)}
                                disabled={isEnded}
                            >
                                ✨ GOLD
                            </button>

                            <button
                                className="btn-secondary"
                                onClick={() => clearPromotion(a.id)}
                                disabled={!hasPromo}
                            >
                                Зняти просування
                            </button>

                            <button
                                className="btn-danger"
                                onClick={() => softDelete(a.id)}
                                disabled={isEnded || isRemoved}
                            >
                                Завершити
                            </button>
                        </div>
                    </div>
                )
            })}

            {filteredAuctions.length > PAGE_SIZE && (
                <AdminPagination
                    page={page}
                    pageSize={PAGE_SIZE}
                    totalItems={filteredAuctions.length}
                    labels={paginationLabels}
                    onPageChange={setPage}
                />
            )}

        </div>
    )
}

export default AdminAuctionsPage
