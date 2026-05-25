import { useEffect, useState } from "react"
import { auth, db } from "../app/firebase"
import type { Ad } from "../types/ad"
import type { AppUser } from "../types/user"
import { getUserByEmail, createUser, isNicknameTaken } from "../data/users"
import { collection, getDocs, query, where, deleteDoc, doc, getDoc, } from "firebase/firestore"
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth"
import { Link, useNavigate } from "react-router-dom"

import { getUserPublicNicknames } from "../data/usersPublic"

import { updateDoc, arrayUnion, serverTimestamp } from "firebase/firestore"
import type { translations } from '../app/i18n'

import { getLocalUser, setLocalUser, clearLocalUser } from "../data/localUser"
import type { Auction } from "../types/auction"
import AdCard from "../components/AdCard"
import AuctionCard from "../components/AuctionCard"
import { getUnreadCountForUser, getUserChats } from "../data/chats"
import type { ChatItem } from "../data/chats"
import { buildAdPath, buildAuctionPath } from '../utils/slug'
type Props = {
    t: (typeof translations)[keyof typeof translations]
}
type ChatListRow = {
    id: string
    otherUserId: string
    otherNickname: string
    lastMessage: string
    updatedAt?: number
    isUnread: boolean
    isNewChat: boolean
    unreadCount: number
}

type ModeratedOwnerItem = {
    status?: string
    moderationReason?: string | null
    ownerNotificationStatus?: "unread" | "read" | null
    ownerNotificationMessage?: string | null
    moderatedAt?: number | null
    restoredAt?: number | null
}




function AccountPage({ t }: Props) {
    const a = t.account
    const containsCyrillic = (value: string) => /[А-Яа-яЁёІіЇїЄєҐґ]/.test(value)
    const isLatinNickname = (value: string) => /^[A-Za-z0-9._-]+$/.test(value.trim())
    const navigate = useNavigate()
    const [now] = useState(() => Date.now())
    type AuthMode = "login" | "register"

    function getOwnerStatusLabel(status?: string): string {
        if (status === "hidden") return a.moderation.statusHidden
        if (status === "deleted") return a.moderation.statusDeleted
        if (status === "removed") return a.moderation.statusRemoved
        if (status === "pending_payment") return a.moderation.statusPendingPayment
        return a.moderation.statusActive
    }

    function renderModerationNotice(item: ModeratedOwnerItem) {
        const hasModerationStatus = ["hidden", "deleted", "removed"].includes(item.status ?? "")
        const hasNotice = hasModerationStatus || !!item.ownerNotificationMessage || !!item.moderationReason || !!item.restoredAt
        if (!hasNotice) return null

        const isUnread = item.ownerNotificationStatus === "unread"

        return (
            <div
                className="card stack8"
                style={{
                    border: isUnread ? "2px solid #f59e0b" : "1px solid #fde68a",
                    background: isUnread ? "#fffbeb" : "#fff7ed",
                    color: "#78350f",
                    fontSize: 14,
                }}
            >
                <div>
                    <b>{isUnread ? a.moderation.unreadNotice : a.moderation.notice}</b>
                    {" · "}
                    {getOwnerStatusLabel(item.status)}
                </div>
                {item.ownerNotificationMessage && <div>{item.ownerNotificationMessage}</div>}
                {item.moderationReason && (
                    <div>
                        <b>{a.moderation.reason}:</b> {item.moderationReason}
                    </div>
                )}
                {item.restoredAt && (
                    <div>
                        <b>{a.moderation.restored}:</b> {new Date(item.restoredAt).toLocaleString(a.chats.timeLocale)}
                    </div>
                )}
                <div>{a.moderation.contactSupport}</div>
            </div>
        )
    }

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
    const [resetLoading, setResetLoading] = useState(false)
    const [resetMessage, setResetMessage] = useState<string | null>(null)

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
            const names = await getUserPublicNicknames(missing, a.chats.userFallback)
            const pairs = Object.entries(names)

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

        getUserChats(user.id, user.uid)
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

        const ok = window.confirm(a.confirms.deleteAuction)
        if (!ok) return

        try {
            await deleteDoc(doc(db, "auctions", auctionId))

            // убираем из UI
            setMyAuctions(prev => prev.filter(a => a.id !== auctionId))
        } catch (e) {
            console.error(e)
            alert(a.alerts.deleteAuctionError)
        }
    }


    async function handleDeleteAd(adId: string) {
        if (!user) return

        const confirmDelete = window.confirm(a.confirms.deleteAd)
        if (!confirmDelete) return

        try {
            // 1️⃣ удаляем из Firestore
            await deleteDoc(doc(db, "ads", adId))

            // 2️⃣ убираем из UI
            setMyAds(prev => prev.filter(ad => ad.id !== adId))
        } catch (err) {
            console.error(err)
            alert(a.alerts.deleteAdError)
        }
    }

    async function handleDeleteChat(chatId: string) {
        if (!user) return

        const ok = window.confirm(a.confirms.deleteChat)
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
            alert(a.alerts.deleteChatError)
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

            alert(a.alerts.contactsSaved)

        } catch (e) {
            console.error(e)
            alert(a.alerts.saveContactsError)
        }
    }

    // ============================
    // LOADING
    // ============================
    if (isLoading) {
        return <div className="card">{a.loading}</div>

    }
// починил
    // ============================
    // AUTH (LOGIN / REGISTER)
    // ============================
    if (!user) {
        return (
            <div className="card stack12">
                <h2 className="h2">{a.title}</h2>

                <div style={{display: "flex", gap: 8}}>
                    <button
                        className={mode === "login" ? "btn-primary" : "btn-secondary"}
                        type="button"
                        onClick={() => setMode("login")}
                    >
                        {a.auth.loginTab}
                    </button>

                    <button
                        className={mode === "register" ? "btn-primary" : "btn-secondary"}
                        type="button"
                        onClick={() => setMode("register")}
                    >
                        {a.auth.registerTab}
                    </button>
                </div>

                {mode === "register" && (
                    <input
                        className="input"
                        placeholder={a.auth.nicknamePlaceholder}
                        value={nickname}
                        onChange={e => setNickname(e.target.value)}
                    />
                )}


                <input
                    className="input"
                    type="email"
                    placeholder={a.auth.emailPlaceholder}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                />

                <input
                    className="input"
                    type="password"
                    placeholder={a.auth.passwordPlaceholder}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                />
                {mode === "login" && (
                    <button
                        type="button"
                        className="btn-secondary"
                        disabled={resetLoading}
                        onClick={async () => {
                            setAuthError(null)
                            setResetMessage(null)

                            const cleanEmail = email.trim().toLowerCase()
                            if (!cleanEmail) {
                                setAuthError("Введите email.")
                                return
                            }

                            try {
                                setResetLoading(true)
                                await sendPasswordResetEmail(auth, cleanEmail)
                                setResetMessage("Письмо для восстановления пароля отправлено на email.")
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            } catch (error: any) {
                                const code = error?.code as string | undefined
                                if (code === "auth/invalid-email") {
                                    setAuthError("Неверный формат email.")
                                } else if (code === "auth/user-not-found") {
                                    setAuthError("Пользователь с таким email не найден.")
                                } else if (code === "auth/too-many-requests") {
                                    setAuthError("Слишком много попыток. Попробуйте позже.")
                                } else {
                                    setAuthError("Не удалось отправить письмо для восстановления. Попробуйте ещё раз.")
                                }
                            } finally {
                                setResetLoading(false)
                            }
                        }}
                    >
                        {a.auth.forgotPassword}
                    </button>
                )}

                {resetMessage && (
                    <div style={{color: "#166534", fontSize: 13}}>
                        {resetMessage}
                    </div>
                )}

                {authError && (
                    <div style={{color: "#b91c1c", fontSize: 13}}>
                        {authError}
                    </div>
                )}

                <button
                    className="btn-primary"
                    disabled={
                        authLoading ||
                        password.length < 4 ||
                        (mode === "register" && !nickname.trim())
                    }
                    onClick={async () => {
                        setAuthError(null)
                        setAuthLoading(true)
                        const mapAuthError = (code?: string) => {
                            if (code === "auth/email-already-in-use") return "Этот email уже используется."
                            if (code === "auth/invalid-email") return "Неверный формат email."
                            if (code === "auth/user-not-found") return "Пользователь с таким email не найден."
                            if (code === "auth/wrong-password") return "Неверный пароль."
                            if (code === "auth/invalid-credential") return "Неверный email или пароль."
                            if (code === "auth/weak-password") return "Слишком слабый пароль."
                            if (code === "auth/too-many-requests") return "Слишком много попыток. Попробуйте позже."
                            return "Ошибка авторизации. Попробуйте ещё раз."
                        }
                        try {
                            const cleanEmail = email.trim().toLowerCase()
                            // ===== LOGIN =====
                            if (!cleanEmail) {
                                setAuthError("Введите email.")
                                return
                            }
                            if (!cleanEmail.includes("@")) {
                                setAuthError("Email должен содержать символ @.")
                                return
                            }
                            if (containsCyrillic(cleanEmail)) {
                                setAuthError(a.auth.errors.emailLatinOnly)
                                return
                            }
                            if (mode === "register") {
                                if (containsCyrillic(nickname) || !isLatinNickname(nickname)) {
                                    setAuthError(a.auth.errors.nicknameLatinOnly)
                                    return
                                }
                            }
                            if (mode === "login") {
                                const authRes = await signInWithEmailAndPassword(auth, cleanEmail, password)
                                const profile = await getUserByEmail(cleanEmail)



                                const mergedUser: AppUser = {

                                    id: cleanEmail,
                                    uid: authRes.user.uid,
                                    email: cleanEmail,
                                    nickname: profile?.nickname || cleanEmail.split("@")[0],
                                    karma: typeof profile?.karma === "number" ? profile.karma : 0,
                                    createdAt: typeof profile?.createdAt === "number" ? profile.createdAt : Date.now(),
                                    phone: profile?.phone ?? null,
                                    telegram: profile?.telegram ?? null,
                                }

                                if (!profile || profile.uid !== authRes.user.uid) {
                                    await createUser(mergedUser)
                                }

                                // сохраняем сессию
                                setLocalUser(mergedUser)
                                setUser(mergedUser)
                                return
                            }


                            // ===== REGISTER =====
                            // ===== REGISTER =====
                            const existingByEmail = await getUserByEmail(cleanEmail)
                            if (existingByEmail) {
                                setAuthError(a.auth.errors.emailTaken)
                                return
                            }

                            const nicknameTaken = await isNicknameTaken(nickname)
                            if (nicknameTaken) {
                                setAuthError(a.auth.errors.nicknameTaken)
                                return
                            }

                            const authRes = await createUserWithEmailAndPassword(auth, cleanEmail, password)
                            const newUser: AppUser = {
                                id: cleanEmail,
                                uid: authRes.user.uid,
                                nickname: nickname.trim(),
                                email: cleanEmail,
                                karma: 0,
                                createdAt: Date.now(),
                            }

// ===== REGISTER =====

                            // Firestore
                            await createUser(newUser)

                            // localStorage
                            setLocalUser(newUser)
                            setUser(newUser)

                            setNickname("")
                            setEmail("")
                            setPassword("")
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        } catch (error: any) {
                            setAuthError(mapAuthError(error?.code))
                        } finally {
                            setAuthLoading(false)
                        }
                    }}
                >

                    {authLoading
                        ? a.auth.loadingBtn
                        : mode === "login"
                            ? a.auth.loginBtn
                            : a.auth.registerBtn}

                </button>


                <div style={{fontSize: 12, color: "#6b7280"}}>
                    {a.auth.contactsHint}
                </div>
            </div>
        )
    }
    const chatRows: ChatListRow[] = user
        ? chats
            .map(chat => {
                const otherUserId = chat.users.find(id => id !== user.id) || ""
                const unreadCount = getUnreadCountForUser(chat, [user.id, user.uid, user.email].filter(Boolean))
                const isUnread = unreadCount > 0
                const isNewChat = chat.lastMessage === ""


                return {
                    id: chat.id,
                    otherUserId,
                    otherNickname: chat.lastSenderType === "system" && chat.lastSenderName
                        ? chat.lastSenderName
                        : otherUserId
                            ? (nickCache[otherUserId] || "…")
                            : a.chats.userFallback,
                    lastMessage: chat.lastMessage || a.chats.noMessages,

                    updatedAt: chat.updatedAt,
                    isUnread,
                    isNewChat,
                    unreadCount,
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
                <Link
                    to="/account/payments"
                    className="btn-secondary"
                    style={{display: "inline-block", textAlign: "center"}}
                >
                    {a.payments.link}
                </Link>

                <div className="card stack12">
                    <h3 className="h3">{a.profile.contactsTitle}</h3>

                    <div style={{fontSize: 13, color: "#b45309"}}>
                        ⚠️ {a.profile.contactsWarn}
                    </div>

                    <input
                        className="input"
                        type="tel"
                        placeholder={a.profile.phonePlaceholder}

                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                    />

                    <input
                        className="input"
                        type="text"
                        placeholder={a.profile.telegramPlaceholder}
                        value={telegram}
                        onChange={e => setTelegram(e.target.value)}
                    />
                </div>
                <button
                    className="btn-primary"
                    onClick={handleSaveContacts}
                >
                    {a.profile.saveContacts}
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
                            a.confirms.deleteContacts
                        )
                        if (!confirmDelete) return

                        try {
                            await updateDoc(doc(db, "users", user.id), {
                                phone: null,
                                telegram: null,
                            })

                            setPhone("")
                            setTelegram("")
                            alert(a.alerts.contactsDeleted)
                        } catch (e) {
                            console.error(e)
                            alert(a.confirms.deleteContacts)
                        }
                    }}
                >
                    {a.profile.deleteContacts}
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
                    {a.profile.logout}
                </button>
            </div>
            <div className="card stack12" id="account-chats">
                <h3 className="h3">{a.chats.title}</h3>


                {loadingChats && <div>{a.loading}</div>}

                {!loadingChats && chatRows.length === 0 && (
                    <div style={{fontSize: 14, color: "#6b7280"}}>
                        {a.chats.none}
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
            {row.unreadCount > 99 ? "99+" : row.unreadCount}
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
                                        {row.isNewChat ? a.chats.newChat : row.lastMessage}


                                    </div>


                                    {typeof row.updatedAt === "number" && (
                                        <div style={{fontSize: 12, color: "#9ca3af"}}>
                                            {new Date(row.updatedAt).toLocaleString(a.chats.timeLocale)}
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
                                    {a.chats.deleteBtn}
                                </button>


                            </div>

                        ))}
                    </div>
                )}
            </div>


            {/* MY ADS */}
            <div className="card stack12">
                <h3 className="h3">{a.myAds.title}</h3>

                {myAds.length === 0 ? (
                    <div style={{color: "#6b7280", fontSize: 14}}>
                        {a.myAds.empty}
                    </div>

                ) : (
                    <div className="ads-grid">
                    {myAds.map(ad => (
                            <div key={ad.id} className="stack8">
                                {renderModerationNotice(ad)}
                                <Link to={buildAdPath(ad.title, ad.city, ad.id)} style={{textDecoration: "none", color: "inherit", display: "block",}}>
                                    <AdCard
                                        ad={ad}
                                        userNickname={user.nickname}
                                        isMine={true}

                                        labels={t.adCard}
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
                <h3 className="h3">{a.myAuctions.title}</h3>

                {myAuctions.length === 0 ? (
                    <div style={{color: "#6b7280", fontSize: 14}}>
                        {a.myAds.empty}
                    </div>

                ) : (
                    <div className="stack12">
                    {myAuctions.map((auction: Auction) => {

                            const isEnded = auction.endsAt <= now

                            return (
                                <div key={auction.id} className="stack8">
                                    {renderModerationNotice(auction)}
                                    <AuctionCard
                                        t={t}

                                        title={auction.title}
                                        city={auction.city}
                                        currentBid={auction.startPrice}
                                        timeLeft={
                                            isEnded
                                                ? a.myAuctions.ended
                                                : `${Math.ceil((auction.endsAt - now) / 60000)} ${a.myAuctions.minutesShort}`
                                        }

                                        image={auction.images?.[0]}
                                        ownerName={auction.ownerNickname?.trim() || auction.ownerName?.trim() || user.nickname}
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
                                            {a.myAuctions.endedInfo}
                                        </div>
                                    )}

                                    <div style={{display: "flex", gap: 8}}>
                                        <button
                                            className="btn-secondary"
                                            onClick={() => navigate(buildAuctionPath(auction.title, auction.city, auction.id))}
                                        >
                                            {a.myAuctions.goTo}
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
                                            {a.myAuctions.deleteBtn}

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
