import { useEffect, useState } from "react"
import { db } from "../app/firebase"
import type { Ad } from "../types/ad"
import type { AppUser } from "../types/user"
import { getUserByEmail, createUser, isNicknameTaken } from "../data/users"
import { collection, getDocs, query, where, deleteDoc, doc, getDoc, } from "firebase/firestore"

import { Link, useNavigate } from "react-router-dom"

import { getUserPublicNickname } from "../data/usersPublic"

import { updateDoc, arrayUnion, serverTimestamp } from "firebase/firestore"


import { getLocalUser, setLocalUser, clearLocalUser } from "../data/localUser"
import type { Auction } from "../types/auction"
import AdCard from "../components/AdCard"
import AuctionCard from "../components/AuctionCard"
import { getUserChats } from "../data/chats"
type ChatItem = {
    id: string
    users: string[]
    lastMessage: string
    unreadFor?: string[]
    updatedAt?: number
}

type ChatListRow = {
    id: string
    otherUserId: string
    otherNickname: string
    lastMessage: string
    updatedAt?: number
    isUnread: boolean
    isNewChat: boolean
}




function AccountPage() {
    const navigate = useNavigate()
    const [now] = useState(() => Date.now())
    type AuthMode = "login" | "register"

    const [mode, setMode] = useState<AuthMode>("login")


    // ui / auth
    const [isLoading, setIsLoading] = useState(true)
    const [authLoading, setAuthLoading] = useState(false)
    const [authError, setAuthError] = useState<string | null>(null)

    const [chats, setChats] = useState<ChatItem[]>([])
    const [nickCache, setNickCache] = useState<Record<string, string>>({})

    const [loadingChats, setLoadingChats] = useState(true)

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



    useEffect(() => {
        if (!user) return
        if (chats.length === 0) return

        // собеседники = второй пользователь в массиве users
        const otherIds = Array.from(
            new Set(
                chats
                    .map(c => c.users.find(id => id !== user.id))
                    .filter((x): x is string => !!x)
            )
        )

        const missing = otherIds.filter(id => !nickCache[id])
        if (missing.length === 0) return

            ;(async () => {
            const pairs = await Promise.all(
                missing.map(async (id) => {
                    const nick = await getUserPublicNickname(id)
                    return [id, nick || "Користувач"] as const
                })
            )

            setNickCache(prev => {
                const next = { ...prev }
                for (const [id, nick] of pairs) next[id] = nick
                return next
            })
        })()
        // важно: nickCache в deps НЕ добавляем, иначе будет лишняя “гонка”
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chats, user])

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


    useEffect(() => {
        if (!user) return

        setLoadingChats(true)

        getUserChats(user.id)
            .then((items) => {
                setChats(items)
            })
            .finally(() => setLoadingChats(false))
    }, [user])



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

    async function handleDeleteAuction(auctionId: string) {
        if (!user) return

        const ok = window.confirm("Ви впевнені, що хочете видалити цей аукціон?")
        if (!ok) return

        try {
            await deleteDoc(doc(db, "auctions", auctionId))

            // убираем из UI
            setMyAuctions(prev => prev.filter(a => a.id !== auctionId))
        } catch (e) {
            console.error(e)
            alert("Помилка при видаленні аукціону")
        }
    }


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

    async function handleDeleteChat(chatId: string) {
        if (!user) return

        const ok = window.confirm("Видалити цей чат?")
        if (!ok) return

        try {
            await updateDoc(doc(db, "chats", chatId), {
                hiddenFor: arrayUnion(user.id),
                [`hiddenForAt.${user.id}`]: serverTimestamp(),
            })


            // сразу убираем из UI
            setChats(prev => prev.filter(c => c.id !== chatId))
        } catch (e) {
            console.error(e)
            alert("Помилка при видаленні чату")
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
    const chatRows: ChatListRow[] = user
        ? chats
            .map(chat => {
                const otherUserId = chat.users.find(id => id !== user.id) || ""
                const isUnread = chat.unreadFor?.includes(user.id) ?? false
                const isNewChat = chat.lastMessage === ""


                return {
                    id: chat.id,
                    otherUserId,
                    otherNickname: otherUserId
                        ? (nickCache[otherUserId] || "…")
                        : "Користувач",
                    lastMessage: chat.lastMessage || "Без повідомлень",
                    updatedAt: chat.updatedAt,
                    isUnread,
                    isNewChat,
                }
            })
            .filter(row => !!row.otherUserId)
            .sort((a, b) => {
                if (a.isUnread && !b.isUnread) return -1
                if (!a.isUnread && b.isUnread) return 1
                return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
            })
        : []


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
            <div className="card stack12">
                <h3 className="h3">Мої чати</h3>


                {loadingChats && <div>Завантаження…</div>}

                {!loadingChats && chatRows.length === 0 && (
                    <div style={{fontSize: 14, color: "#6b7280"}}>
                        Чатів поки немає
                    </div>
                )}

                {!loadingChats && chatRows.length > 0 && (
                    <div
                        className="stack8"
                        style={{
                            maxHeight: 460,          // ≈ 5 чатов
                            overflowY: "auto",
                            paddingRight: 4,         // чтобы скролл не прижимал контент
                        }}
                    >
                        {chatRows.map(row => (
                            <div
                                key={row.id}
                                onClick={() => navigate(`/chat/${row.id}`)}
                                style={{
                                    padding: 12,
                                    borderRadius: 10,
                                    border: row.isUnread
                                        ? "2px solid #1976d2"
                                        : "1px solid #e5e7eb",
                                    background: row.isUnread ? "#eef6ff" : "#fff",
                                    cursor: "pointer",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 8,
                                }}

                            >
                                <div style={{display: "flex", flexDirection: "column", gap: 4}}>
                                    <div style={{display: "flex", alignItems: "center", gap: 6}}>
    <span style={{fontWeight: 700}}>
        {row.otherNickname}
    </span>

                                        {row.isUnread && (
                                            <span
                                                style={{
                                                    fontSize: 10,
                                                    background: "#1976d2",
                                                    color: "#fff",
                                                    padding: "2px 6px",
                                                    borderRadius: 999,
                                                }}
                                            >
            new
        </span>
                                        )}
                                    </div>


                                    <div
                                        style={{
                                            fontSize: 14,
                                            color: row.isUnread ? "#111827" : "#6b7280",
                                            fontWeight: row.isUnread ? 600 : 400,
                                        }}
                                    >
                                        {row.isNewChat ? "Новий чат" : row.lastMessage}

                                    </div>


                                    {typeof row.updatedAt === "number" && (
                                        <div style={{fontSize: 12, color: "#9ca3af"}}>
                                            {new Date(row.updatedAt).toLocaleString("uk-UA")}
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteChat(row.id)
                                    }}
                                    style={{
                                        background: "#fee2e2",
                                        color: "#991b1b",
                                        border: "none",
                                        padding: 8,
                                        borderRadius: 10,
                                        fontSize: 13,
                                        cursor: "pointer",
                                    }}
                                >
                                    Видалити
                                </button>


                            </div>

                        ))}
                    </div>
                )}
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
                    <div style={{color: "#6b7280", fontSize: 14}}>
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
                                    {isEnded && (
                                        <div
                                            style={{
                                                fontSize: 12,
                                                color: "#6b7280",
                                                marginTop: 4,
                                            }}
                                        >
                                            Завершений аукціон буде видалено через 5 днів
                                        </div>
                                    )}

                                    <div style={{display: "flex", gap: 8}}>
                                        <button
                                            className="btn-secondary"
                                            onClick={() => navigate(`/auction/${auction.id}`)}
                                        >
                                            Перейти
                                        </button>

                                        <button
                                            onClick={() => handleDeleteAuction(auction.id)}
                                            style={{
                                                background: "#fee2e2",
                                                color: "#991b1b",
                                                border: "none",
                                                padding: 8,
                                                borderRadius: 10,
                                                fontSize: 13,
                                                cursor: "pointer",
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
