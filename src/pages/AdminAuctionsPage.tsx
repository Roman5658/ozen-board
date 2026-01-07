import { useEffect, useState } from "react"
import {
    collection,
    getDocs,
    doc,
    updateDoc,
    deleteDoc,
} from "firebase/firestore"


import { db } from "../app/firebase"
import type { Auction } from "../types/auction"

const DAY = 24 * 60 * 60 * 1000

function AdminAuctionsPage() {
    const [auctions, setAuctions] = useState<Auction[]>([])
    const [loading, setLoading] = useState(true)

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
            setLoading(false)
        }

        loadAuctions()
    }, [])

    // =========================
    // ADMIN ACTIONS
    // =========================

    async function setTop(auctionId: string) {
        const now = Date.now()

        await updateDoc(doc(db, "auctions", auctionId), {
            promotionType: "top-auction",
            promotionUntil: now + 3 * DAY,
            promotionQueueAt: null,
        })

        setAuctions(prev =>
            prev.map(a =>
                a.id === auctionId
                    ? {
                        ...a,
                        promotionType: "top-auction",
                        promotionUntil: now + 3 * DAY,
                    }
                    : a
            )
        )
    }


    async function setFeatured(auctionId: string) {
        const now = Date.now()

        await updateDoc(doc(db, "auctions", auctionId), {
            promotionType: "featured",
            promotionUntil: now + 3 * DAY,
            promotionQueueAt: null,
        })

        setAuctions(prev =>
            prev.map(a =>
                a.id === auctionId
                    ? {
                        ...a,
                        promotionType: "featured",
                        promotionUntil: now + 3 * DAY,
                    }
                    : a
            )
        )
    }


    async function setGold(auctionId: string) {
        const now = Date.now()

        await updateDoc(doc(db, "auctions", auctionId), {
            promotionType: "highlight-gold",
            promotionUntil: now + 7 * DAY,
            promotionQueueAt: null,
        })

        setAuctions(prev =>
            prev.map(a =>
                a.id === auctionId
                    ? {
                        ...a,
                        promotionType: "highlight-gold",
                        promotionUntil: now + 7 * DAY,
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

    async function hardDelete(auctionId: string) {
        const ok = window.confirm("❌ Видалити аукціон назавжди?")
        if (!ok) return

        await deleteDoc(doc(db, "auctions", auctionId))

        setAuctions(prev =>
            prev.filter(a => a.id !== auctionId)
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

            {auctions.length === 0 && (
                <div className="card">Аукціонів немає</div>
            )}

            {auctions.map(a => {
                const isEnded = a.status === "ended"
                const hasPromo =
                    a.promotionType !== "none" &&
                    a.promotionUntil &&
                    a.promotionUntil > Date.now()

                return (
                    <div key={a.id} className="card stack8">
                        <div style={{ fontWeight: 700 }}>{a.title}</div>

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
                            <button
                                className="btn-secondary"
                                onClick={() => setTop(a.id)}
                                disabled={isEnded}
                            >
                                🔥 TOP
                            </button>
                            <button
                                className="btn-danger"
                                onClick={() => hardDelete(a.id)}
                            >
                                ❌ Видалити назавжди
                            </button>

                            <button
                                className="btn-secondary"
                                onClick={() => setFeatured(a.id)}
                                disabled={isEnded}
                            >
                                ⭐ FEATURED
                            </button>

                            <button
                                className="btn-secondary"
                                onClick={() => setGold(a.id)}
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
                                disabled={isEnded}
                            >
                                Завершити
                            </button>
                        </div>
                    </div>
                )
            })}

        </div>
    )
}

export default AdminAuctionsPage
