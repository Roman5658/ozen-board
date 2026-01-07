import { useEffect, useState } from "react"
import { collection, getDocs } from "firebase/firestore"


import { db } from "../app/firebase"
import type { Ad } from "../types/ad"



function AdminAdsPage() {
    const [ads, setAds] = useState<Ad[]>([])
    const [loading, setLoading] = useState(true)

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
            setLoading(false)
        }

        loadAds()
    }, [])

    // -------------------------
    // действия администратора
    // -------------------------

    // async function setTop(adId: string, type: "top3" | "top6") {
    //     const now = Date.now()
    //
    //     await updateDoc(doc(db, "ads", adId), {
    //         pinType: type,
    //         pinnedAt: now,
    //         pinnedUntil: now + 3 * DAY,
    //         pinQueueAt: null,
    //     })
    //
    //     setAds(prev =>
    //         prev.map(a =>
    //             a.id === adId
    //                 ? {
    //                     ...a,
    //                     pinType: type,
    //                     pinnedAt: now,
    //                     pinnedUntil: now + 3 * DAY,
    //                     pinQueueAt: undefined,
    //                 }
    //                 : a
    //         )
    //     )
    // }

    // async function clearTop(adId: string) {
    //     await updateDoc(doc(db, "ads", adId), {
    //         pinType: null,
    //         pinnedAt: null,
    //         pinnedUntil: null,
    //         pinQueueAt: null,
    //     })
    //
    //     setAds(prev =>
    //         prev.map(a =>
    //             a.id === adId
    //                 ? {
    //                     ...a,
    //                     pinType: undefined,
    //                     pinnedAt: undefined,
    //                     pinnedUntil: undefined,
    //                     pinQueueAt: undefined,
    //                 }
    //                 : a
    //         )
    //     )
    // }

    // async function softDelete(adId: string) {
    //     const ok = window.confirm("Помітити оголошення як видалене?")
    //     if (!ok) return
    //
    //     await updateDoc(doc(db, "ads", adId), {
    //         status: "deleted",
    //     })
    //
    //     setAds(prev =>
    //         prev.map(a =>
    //             a.id === adId
    //                 ? { ...a, status: "deleted" }
    //                 : a
    //         )
    //     )
    // }

    // -------------------------
    // UI
    // -------------------------

    if (loading) {
        return <div className="card">Завантаження…</div>
    }
    const now = Date.now()

    const activeTop3 = ads.filter(
        a =>
            a.pinType === "top3" &&
            a.pinnedUntil &&
            a.pinnedUntil > now
    )

    const activeTop6 = ads.filter(
        a =>
            a.pinType === "top6" &&
            a.pinnedUntil &&
            a.pinnedUntil > now
    )

    const queueTop3 = ads
        .filter(a =>
            a.pinType === "top3" &&
            a.pinQueueAt &&
            (!a.pinnedUntil || a.pinnedUntil <= now)
        )
        .sort((a, b) => a.pinQueueAt! - b.pinQueueAt!)

    const queueTop6 = ads
        .filter(a =>
            a.pinType === "top6" &&
            a.pinQueueAt &&
            (!a.pinnedUntil || a.pinnedUntil <= now)
        )
        .sort((a, b) => a.pinQueueAt! - b.pinQueueAt!)

    return (
        <div className="stack12">
            <h2 className="h2">Адмін · Оголошення</h2>
            {/* 🔥 ACTIVE TOP 3 */}
            {activeTop3.length > 0 && (
                <>
                    <h3>🔥 Активні TOP 3</h3>
                    {activeTop3.map(ad => (
                        <div key={ad.id} className="card stack8">
                            <b>{ad.title}</b>
                            <div style={{ fontSize: 12 }}>
                                до {new Date(ad.pinnedUntil!).toLocaleString()}
                            </div>
                        </div>
                    ))}
                </>
            )}

            {/* 🔥 ACTIVE TOP 6 */}
            {activeTop6.length > 0 && (
                <>
                    <h3>🔥 Активні TOP 6</h3>
                    {activeTop6.map(ad => (
                        <div key={ad.id} className="card stack8">
                            <b>{ad.title}</b>
                            <div style={{ fontSize: 12 }}>
                                до {new Date(ad.pinnedUntil!).toLocaleString()}
                            </div>
                        </div>
                    ))}
                </>
            )}

            {/* ⏳ QUEUE TOP 3 */}
            {queueTop3.length > 0 && (
                <>
                    <h3>⏳ Черга TOP 3</h3>
                    {queueTop3.map((ad, index) => (
                        <div key={ad.id} className="card stack8">
                            <b>#{index + 1} — {ad.title}</b>
                            <div style={{ fontSize: 12 }}>
                                queued at {new Date(ad.pinQueueAt!).toLocaleString()}
                            </div>
                        </div>
                    ))}
                </>
            )}

            {/* ⏳ QUEUE TOP 6 */}
            {queueTop6.length > 0 && (
                <>
                    <h3>⏳ Черга TOP 6</h3>
                    {queueTop6.map((ad, index) => (
                        <div key={ad.id} className="card stack8">
                            <b>#{index + 1} — {ad.title}</b>
                            <div style={{ fontSize: 12 }}>
                                queued at {new Date(ad.pinQueueAt!).toLocaleString()}
                            </div>
                        </div>
                    ))}
                </>
            )}

            {ads.length === 0 && (
                <div className="card">Оголошень немає</div>
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
