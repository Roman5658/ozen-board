import { useEffect, useState } from "react"
import { collection, getDocs, doc, getDoc, updateDoc, deleteDoc } from "firebase/firestore"

import type { Report } from "../types/report"
import type { Ad } from "../types/ad"

import { db } from "../app/firebase"
import { getLocalUser } from "../data/localUser"
import { ADMIN_USER_ID } from "../app/constants"

function AdminReportsPage() {
    const user = getLocalUser()
    const isAdmin = !!user && String(user.id) === ADMIN_USER_ID

    const [reports, setReports] = useState<Report[]>([])
    const [adsMap, setAdsMap] = useState<Record<string, Ad>>({})
    const [loading, setLoading] = useState(true)

    // -------------------------
    // действия администратора
    // -------------------------

    async function markResolved(reportId: string) {
        await updateDoc(doc(db, "reports", reportId), {
            status: "resolved",
        })

        setReports((prev) =>
            prev.map((r) =>
                r.id === reportId ? { ...r, status: "resolved" } : r
            )
        )
    }

    async function deleteAdByReport(reportId: string, adId: string) {
        const ok = window.confirm("Видалити оголошення назавжди?")
        if (!ok) return

        await deleteDoc(doc(db, "ads", adId))

        await updateDoc(doc(db, "reports", reportId), {
            status: "resolved",
        })

        setReports((prev) =>
            prev.map((r) =>
                r.id === reportId ? { ...r, status: "resolved" } : r
            )
        )

        setAdsMap((prev) => {
            const copy = { ...prev }
            delete copy[adId]
            return copy
        })
    }

    // -------------------------
    // загрузка жалоб
    // -------------------------

    useEffect(() => {
        async function loadReports() {
            if (!isAdmin) {
                setLoading(false)
                return
            }

            const snap = await getDocs(collection(db, "reports"))

            const data: Report[] = snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<Report, "id">),
            }))

            setReports(data)

            const ads: Record<string, Ad> = {}

            for (const r of data) {
                const adSnap = await getDoc(doc(db, "ads", r.adId))
                if (adSnap.exists()) {
                    ads[r.adId] = {
                        id: adSnap.id,
                        ...(adSnap.data() as Omit<Ad, "id">),
                    }
                }
            }

            setAdsMap(ads)
            setLoading(false)
        }

        loadReports()
    }, [isAdmin])

    // -------------------------
    // защита
    // -------------------------

    if (!isAdmin) {
        return (
            <div className="card">
                <h2>Доступ заборонено</h2>
            </div>
        )
    }

    if (loading) {
        return <div className="card">Завантаження…</div>
    }

    // -------------------------
    // UI
    // -------------------------

    return (
        <div className="stack12">
            <h2 className="h2">Скарги користувачів</h2>

            {reports.length === 0 && (
                <div className="card">Скарг поки немає</div>
            )}

            {reports.map((r) => {
                const ad = adsMap[r.adId]

                return (
                    <div key={r.id} className="card stack12">
                        <div style={{ fontSize: 12, fontWeight: 700 }}>
                            Статус: {r.status === "resolved" ? "Вирішено" : "Нове"}
                        </div>

                        {r.status !== "resolved" && (
                            <div className="stack8">
                                <button
                                    className="btn-secondary"
                                    onClick={() => markResolved(r.id)}
                                >
                                    Позначити як вирішено
                                </button>

                                {ad && (
                                    <button
                                        className="btn-danger"
                                        onClick={() => deleteAdByReport(r.id, ad.id)}
                                    >
                                        Видалити оголошення
                                    </button>
                                )}
                            </div>
                        )}

                        <div><b>Оголошення:</b> {r.adTitle}</div>
                        <div><b>Текст:</b> {r.message}</div>

                        {ad && (
                            <div className="card stack8" style={{ background: "#f9fafb" }}>
                                <img
                                    src={ad.image}
                                    alt={ad.title}
                                    style={{
                                        width: "100%",
                                        maxHeight: 180,
                                        objectFit: "contain",
                                        borderRadius: 8,
                                    }}
                                />

                                <div><b>{ad.title}</b></div>
                                <div>{ad.city} · {ad.voivodeship}</div>
                                <div style={{ fontWeight: 700 }}>{ad.price}</div>

                                <a
                                    href={`/ad/${ad.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn-secondary"
                                    style={{ textAlign: "center" }}
                                >
                                    Перейти до оголошення
                                </a>
                            </div>
                        )}

                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                            На користувача: {r.reportedUserId}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export default AdminReportsPage
