import { useEffect, useState } from "react"
import { db } from "../app/firebase"
import type { Ad } from "../types/ad"
import type { AppUser } from "../types/user"
import { getUserByEmail, createUser, isNicknameTaken } from "../data/users"
import { collection, getDocs, query, where, deleteDoc, doc, getDoc, } from "firebase/firestore"

import { Link, useNavigate } from "react-router-dom"
import { updateDoc } from "firebase/firestore"


import { getLocalUser, setLocalUser, clearLocalUser } from "../data/localUser"
import type { Auction } from "../types/auction"
import AdCard from "../components/AdCard"
import AuctionCard from "../components/AuctionCard"

function AccountPage() {
    const navigate = useNavigate()
    const [now] = useState(() => Date.now())
    type AuthMode = "login" | "register"

    const [mode, setMode] = useState<AuthMode>("login")

    // ui / auth
    const [isLoading, setIsLoading] = useState(true)
    const [authLoading, setAuthLoading] = useState(false)
    const [authError, setAuthError] = useState<string | null>(null)

    // auth form
    const [nickname, setNickname] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")

    // data
    const [user, setUser] = useState<AppUser | null>(null)

    const [myAds, setMyAds] = useState<Ad[]>([])
    const [myAuctions, setMyAuctions] = useState<Auction[]>([])

    // contacts (public)
    const [phone, setPhone] = useState("")
    const [telegram, setTelegram] = useState("")
    const [contactsSaved, setContactsSaved] = useState(false)

// ============================
// LOAD MY AUCTIONS (Firestore)
// ============================
    useEffect(() => {
        if (!user) return

        const userId = user.id

        async function loadMyAuctions() {
            const q = query(
                collection(db, "auctions"),
                where("ownerId", "==", userId)
            )

            const snap = await getDocs(q)

            const data: Auction[] = snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as Omit<Auction, "id">),
            }))

            setMyAuctions(data)
        }

        loadMyAuctions()
    }, [user])

    // ============================
    // INITIAL LOAD
    // ============================
    useEffect(() => {
        const u = getLocalUser()

        if (!u || !u.id || !u.email) {
            clearLocalUser()
            setUser(null)
            setIsLoading(false)
            return
        }

        const userId = u.id // ✅ фиксируем
        setUser(u)

        async function loadContacts() {
            const ref = doc(db, "users", userId)

            const snap = await getDoc(ref)

            if (snap.exists()) {
                const data = snap.data()
                setPhone(typeof data.phone === "string" ? data.phone : "")
                setTelegram(typeof data.telegram === "string" ? data.telegram : "")
            }
        }

        loadContacts().finally(() => setIsLoading(false))
    }, [])



    // ============================
    // LOAD MY ADS (Firestore)
    // ============================
    useEffect(() => {
        if (!user) return

        const userId = user.id

        async function loadMyAds() {
            const q = query(
                collection(db, "ads"),
                where("userId", "==", userId)
            )

            const snap = await getDocs(q)
            const data: Ad[] = snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as Omit<Ad, "id">),
            }))

            setMyAds(data)
        }

        loadMyAds()
    }, [user])

    async function handleDeleteAd(adId: string) {
        if (!user) return

        const confirmDelete = window.confirm("Ви впевнені, що хочете видалити оголошення?")
        if (!confirmDelete) return

        try {
            // 1️⃣ удаляем из Firestore
            await deleteDoc(doc(db, "ads", adId))

            // 2️⃣ убираем из UI
            setMyAds(prev => prev.filter(ad => ad.id !== adId))
        } catch (err) {
            console.error(err)
            alert("Помилка при видаленні оголошення")
        }
    }
    async function handleSaveContacts() {
        if (!user) return

        try {
            await updateDoc(doc(db, "users", user.id), {
                phone: phone.trim() || null,
                telegram: telegram.trim() || null,
            })
            setContactsSaved(true)

            setTimeout(() => {
                setContactsSaved(false)
            }, 3000)

            alert("Контакти збережено")

        } catch (e) {
            console.error(e)
            alert("Помилка при збереженні контактів")
        }
    }

    // ============================
    // LOADING
    // ============================
    if (isLoading) {
        return <div className="card">Завантаження…</div>
    }

    // ============================
    // AUTH (LOGIN / REGISTER)
    // ============================
    if (!user) {
        return (
            <div className="card stack12">
                <h2 className="h2">Акаунт</h2>
                <div style={{display: "flex", gap: 8}}>
                    <button
                        className={mode === "login" ? "btn-primary" : "btn-secondary"}
                        type="button"
                        onClick={() => setMode("login")}
                    >
                        Вхід
                    </button>

                    <button
                        className={mode === "register" ? "btn-primary" : "btn-secondary"}
                        type="button"
                        onClick={() => setMode("register")}
                    >
                        Реєстрація
                    </button>
                </div>

                {mode === "register" && (
                    <input
                        className="input"
                        placeholder="Нікнейм"
                        value={nickname}
                        onChange={e => setNickname(e.target.value)}
                    />
                )}


                <input
                    className="input"
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                />

                <input
                    className="input"
                    type="password"
                    placeholder="Пароль"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                />

                {authError && (
                    <div style={{color: "#b91c1c", fontSize: 13}}>
                        {authError}
                    </div>
                )}

                <button
                    className="btn-primary"
                    disabled={
                        authLoading ||
                        !email.includes("@") ||
                        password.length < 4 ||
                        (mode === "register" && !nickname.trim())
                    }
                    onClick={async () => {
                        setAuthError(null)
                        setAuthLoading(true)

                        try {
                            const cleanEmail = email.trim().toLowerCase()
                            // ===== LOGIN =====
                            if (mode === "login") {
                                const existing = await getUserByEmail(cleanEmail)

                                if (!existing) {
                                    setAuthError("Користувача не знайдено")
                                    return
                                }

                                if (existing.password !== password) {
                                    setAuthError("Невірний пароль")
                                    return
                                }

                                // сохраняем сессию
                                setLocalUser(existing)
                                setUser(existing)
                                return
                            }


                            // ===== REGISTER =====
                            // ===== REGISTER =====
                            const existing = await getUserByEmail(cleanEmail)

                            if (existing) {
                                setAuthError("Такий email вже зареєстрований")
                                return
                            }


                            const newUser: AppUser = {
                                id: cleanEmail,
                                nickname: nickname.trim(),
                                email: cleanEmail,
                                password: password,
                                karma: 0,
                                createdAt: Date.now(),
                            }

// ===== REGISTER =====
                            const existingByEmail = await getUserByEmail(cleanEmail)

                            if (existingByEmail) {
                                setAuthError("Такий email вже зареєстрований")
                                return
                            }

                            const nicknameTaken = await isNicknameTaken(nickname)

                            if (nicknameTaken) {
                                setAuthError("Такий нікнейм вже зайнятий")
                                return
                            }

                            // Firestore
                            await createUser(newUser)

                            // localStorage
                            setLocalUser(newUser)
                            setUser(newUser)

                            setNickname("")
                            setEmail("")
                            setPassword("")
                        } finally {
                            setAuthLoading(false)
                        }
                    }}
                >

                    {authLoading
                        ? "Завантаження..."
                        : mode === "login"
                            ? "Увійти"
                            : "Створити акаунт"}
                </button>


                <div style={{fontSize: 12, color: "#6b7280"}}>
                    Контакти додаються безпосередньо в оголошенні
                </div>
            </div>
        )
    }

    // ============================
    // PROFILE
    // ============================
    return (
        <div className="stack12">
            <div className="card stack8">
                <h2 className="h2">{user.nickname}</h2>
                <div style={{fontSize: 14, color: "#6b7280"}}>{user.email}</div>
                <div>Карма: {user.karma}</div>
                <div className="card stack12">
                    <h3 className="h3">Контакти</h3>

                    <div style={{fontSize: 13, color: "#b45309"}}>
                        ⚠️ Ці контакти будуть видимі іншим користувачам
                    </div>

                    <input
                        className="input"
                        type="tel"
                        placeholder="Телефон (необовʼязково)"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                    />

                    <input
                        className="input"
                        type="text"
                        placeholder="Telegram (username)"
                        value={telegram}
                        onChange={e => setTelegram(e.target.value)}
                    />
                </div>
                <button
                    className="btn-primary"
                    onClick={handleSaveContacts}
                >
                    Зберегти контакти
                </button>
                {contactsSaved && (
                    <div style={{fontSize: 13, color: "#15803d"}}>
                        Контакти збережено
                    </div>
                )}
                <button
                    className="btn-secondary"
                    onClick={async () => {
                        if (!user) return

                        const confirmDelete = window.confirm(
                            "Ви впевнені, що хочете видалити всі контакти?"
                        )
                        if (!confirmDelete) return

                        try {
                            await updateDoc(doc(db, "users", user.id), {
                                phone: null,
                                telegram: null,
                            })

                            setPhone("")
                            setTelegram("")
                            alert("Контакти видалено")
                        } catch (e) {
                            console.error(e)
                            alert("Помилка при видаленні контактів")
                        }
                    }}
                >
                    Видалити контакти
                </button>

                <button
                    className="btn-secondary"
                    onClick={() => {
                        clearLocalUser()
                        setUser(null)
                        setMyAds([])
                        setMyAuctions([])
                    }}
                >
                    Вийти
                </button>
            </div>

            {/* MY ADS */}
            <div className="card stack12">
                <h3 className="h3">Мої оголошення</h3>

                {myAds.length === 0 ? (
                    <div style={{color: "#6b7280", fontSize: 14}}>
                        Ви ще не додали жодного оголошення
                    </div>
                ) : (
                    <div className="ads-grid">
                        {myAds.map(ad => (
                            <div key={ad.id} className="stack8">
                                <Link to={`/ad/${ad.id}`} style={{textDecoration: "none", color: "inherit"}}>
                                <AdCard
                                        {...ad}
                                        isMine={true}
                                        showActions={true}
                                        onDelete={() => handleDeleteAd(ad.id)}
                                    />
                                </Link>
                            </div>
                        ))}


                    </div>
                )}
            </div>

            {/* MY AUCTIONS */}
            <div className="card stack12">
                <h3 className="h3">Мої аукціони</h3>

                {myAuctions.length === 0 ? (
                    <div style={{ color: "#6b7280", fontSize: 14 }}>
                        Ви ще не створили жодного аукціону
                    </div>
                ) : (
                    <div className="stack12">
                        {myAuctions.map((auction: Auction) => {

                            const isEnded = auction.endsAt <= now

                            return (
                                <div key={auction.id} className="stack8">
                                    <AuctionCard
                                        title={auction.title}
                                        city={auction.city}
                                        currentBid={auction.startPrice}
                                        timeLeft={
                                            isEnded
                                                ? "Завершено"
                                                : `${Math.ceil((auction.endsAt - now) / 60000)} хв`
                                        }
                                        image={auction.images?.[0]}
                                        isEnded={isEnded}
                                    />

                                    <div style={{ display: "flex", gap: 8 }}>
                                        <button
                                            className="btn-secondary"
                                            onClick={() => navigate(`/auction/${auction.id}`)}
                                        >
                                            Перейти
                                        </button>

                                        <button
                                            style={{
                                                background: "#fee2e2",
                                                color: "#991b1b",
                                                border: "none",
                                                padding: 8,
                                                borderRadius: 10,
                                                fontSize: 13,
                                            }}

                                        >
                                            Видалити
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}

export default AccountPage
