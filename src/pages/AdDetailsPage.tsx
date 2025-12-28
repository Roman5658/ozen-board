import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { addDoc, collection } from "firebase/firestore"
import { getLocalUser } from "../data/localUser"

import { db } from '../app/firebase'
import type { Ad } from '../types/ad'

function AdDetailsPage() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const [isImageOpen, setIsImageOpen] = useState(false)
    const currentUser = getLocalUser()


    const [ad, setAd] = useState<Ad | null>(null)
    const [loading, setLoading] = useState(true)
    const [isReportOpen, setIsReportOpen] = useState(false)
    const [reportText, setReportText] = useState("")
    const [reportSending, setReportSending] = useState(false)


    useEffect(() => {
        async function loadAd() {
            if (!id) return

            const ref = doc(db, 'ads', id)
            const snap = await getDoc(ref)

            if (snap.exists()) {
                setAd({
                    id, // ✅ string из Firestore
                    ...(snap.data() as Omit<Ad, 'id'>),
                })

            } else {
                setAd(null)
            }

            setLoading(false)
        }

        loadAd()
    }, [id])

    if (loading) {
        return <div className="card">Завантаження…</div>
    }

    if (!ad) {
        return <div className="card">Оголошення не знайдено</div>
    }
    const isOwner = !!currentUser && String(currentUser.id) === String(ad.userId)



    return (
        <div className="stack12">
            <button
                onClick={() => navigate(-1)}
                style={{
                    background: 'none',
                    border: 'none',
                    color: '#1976d2',
                    padding: 0,
                    fontSize: '14px',
                    cursor: 'pointer',
                }}
            >
                ← Назад
            </button>

            <div className="card stack12">
                <h2 className="h2">{ad.title}</h2>

                <div style={{ fontSize: '14px', color: '#6b7280' }}>
                    {ad.city} · {ad.voivodeship}
                </div>

                {ad.price && (
                    <div style={{ fontSize: '20px', fontWeight: 700 }}>
                        {ad.price}
                    </div>
                )}
                {/* Продавець (MVP-заглушка) */}
                <div
                    style={{
                        padding: "12px",
                        borderRadius: "12px",
                        background: "#f9fafb",
                        border: "1px solid #e5e7eb",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                    }}
                >
                    <div>
                        <div style={{fontSize: "13px", color: "#6b7280"}}>
                            Продавець
                        </div>

                        <div
                            style={{
                                fontWeight: 700,
                                color: "#1976d2",
                                cursor: "pointer",
                            }}
                            onClick={() => navigate(`/user/${ad.userId}`)}
                        >
                            Перейти до профілю
                        </div>
                    </div>

                    {ad.sellerContact && (
                        <div style={{fontSize: "13px", marginTop: "4px"}}>
                            📞 {ad.sellerContact}
                        </div>
                    )}

                    <div style={{display: "flex", gap: "8px", flexWrap: "wrap"}}>

                        {/* КНОПКА "ЗВʼЯЗАТИСЯ" */}
                        <button
                            className="btn-primary"
                            type="button"
                            disabled={!currentUser || isOwner}
                            onClick={() => {
                                if (!currentUser || isOwner) return
                                navigate(`/user/${ad.userId}`)
                            }}
                        >

                            {!currentUser
                                ? "Увійдіть, щоб звʼязатися"
                                : isOwner
                                    ? "Це ваше оголошення"
                                    : "Звʼязатися"}
                        </button>

                        {/* КНОПКА "ПОСКАРЖИТИСЬ" */}
                        {!isOwner && (
                            <button
                                className="btn-secondary"
                                type="button"
                                disabled={!currentUser}
                                onClick={() => {
                                    if (!currentUser) return
                                    setIsReportOpen(true)
                                }}
                            >
                                {!currentUser ? "Увійдіть, щоб поскаржитись" : "Поскаржитись"}
                            </button>
                        )}
                    </div>

                </div>

                {/* Фото */}
                <div
                    style={{
                        height: '220px',
                        background: '#e5e7eb',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#6b7280',
                        fontSize: '14px',
                        overflow: 'hidden',
                    }}
                >
                    {ad.image ? (

                        <img
                            src={ad.image}
                            alt={ad.title}
                            onClick={() => setIsImageOpen(true)}
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                                background: '#f3f4f6',
                                cursor: 'zoom-in',
                            }}
                            />


                    ) : (
                        'Фото відсутнє'
                    )}
                </div>


                <div style={{fontSize: '15px', lineHeight: 1.6}}>
                    {ad.description ?? 'Опис відсутній'}
                </div>
            </div>
            {isImageOpen && ad.image && (
                <div
                    onClick={() => setIsImageOpen(false)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.8)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        cursor: 'zoom-out',
                    }}
                >
                    <img
                        src={ad.image}
                        alt={ad.title}
                        style={{
                            maxWidth: '90%',
                            maxHeight: '90%',
                            objectFit: 'contain',
                            borderRadius: '12px',
                        }}
                    />
                </div>
            )}
            {isReportOpen && ad && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.6)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 1000,
                    }}
                >
                    <div
                        className="card stack12"
                        style={{ maxWidth: "420px", width: "100%" }}
                    >
                        <h3 className="h3">Поскаржитись на оголошення</h3>

                        <textarea
                            className="input"
                            placeholder="Опишіть проблему"
                            value={reportText}
                            onChange={(e) => setReportText(e.target.value)}
                            rows={4}
                        />

                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                            <button
                                className="btn-secondary"
                                type="button"
                                onClick={() => {
                                    setIsReportOpen(false)
                                    setReportText("")
                                }}
                            >
                                Скасувати
                            </button>

                            <button
                                className="btn-primary"
                                disabled={reportSending || !reportText.trim()}
                                onClick={async () => {
                                    try {
                                        setReportSending(true)

                                        const user = getLocalUser()

                                        await addDoc(collection(db, "reports"), {
                                            adId: ad.id,
                                            adTitle: ad.title,
                                            reportedUserId: ad.userId,
                                            reporterUserId: user?.id,
                                            message: reportText.trim(),
                                            createdAt: Date.now(),
                                            status: "new",
                                        })

                                        alert("Скаргу надіслано")
                                        setIsReportOpen(false)
                                        setReportText("")} catch (e) {
                                        console.error(e)
                                        alert("Помилка при надсиланні скарги")
                                    } finally {
                                        setReportSending(false)
                                    }
                                }}
                            >
                                Надіслати
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}

export default AdDetailsPage
