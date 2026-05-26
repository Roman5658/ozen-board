import { useEffect, useState, type ReactNode } from "react"
import { auth, db } from "../app/firebase"
import type { Ad } from "../types/ad"
import type { AppUser } from "../types/user"
import { getUserByEmail, createUser, isNicknameTaken } from "../data/users"
import { collection, getDocs, query, where, doc, getDoc, } from "firebase/firestore"
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth"
import { Link, useNavigate } from "react-router-dom"

import { updateDoc } from "firebase/firestore"
import type { translations } from '../app/i18n'

import { getLocalUser, setLocalUser, clearLocalUser, isAdmin } from "../data/localUser"
import type { Auction } from "../types/auction"
import AdCard from "../components/AdCard"
import AuctionCard from "../components/AuctionCard"
import { buildAdPath, buildAuctionPath } from '../utils/slug'
type Props = {
    t: (typeof translations)[keyof typeof translations]
    chatUnreadCount?: number
}

type ModeratedOwnerItem = {
    status?: string
    moderationReason?: string | null
    ownerNotificationStatus?: "unread" | "read" | null
    ownerNotificationMessage?: string | null
    moderatedAt?: number | null
    restoredAt?: number | null
    deletedAt?: number | null
    removedAt?: number | null
    endsAt?: number | null
    title?: string
    city?: string
    voivodeship?: string
}




function AccountPage({ t, chatUnreadCount = 0 }: Props) {
    const a = t.account
    const containsCyrillic = (value: string) => /[А-Яа-яЁёІіЇїЄєҐґ]/.test(value)
    const isLatinNickname = (value: string) => /^[A-Za-z0-9._-]+$/.test(value.trim())
    const navigate = useNavigate()
    const [now] = useState(() => Date.now())
    type AuthMode = "login" | "register"

    function getOwnerStatusLabel(status?: string): string {
        if (status === "hidden") return a.moderation.statusHidden
        if (status === "deleted") return a.moderation.statusDeletedByUser
        if (status === "removed") return a.moderation.statusRemoved
        if (status === "expired") return a.moderation.statusExpired
        if (status === "ended") return a.moderation.statusEnded
        if (status === "pending_payment") return a.moderation.statusPendingPayment
        return a.moderation.statusActive
    }

    function formatOwnerDate(ts?: number | null) {
        return ts ? new Date(ts).toLocaleString(a.chats.timeLocale) : null
    }

    function getOwnerStatusDate(item: ModeratedOwnerItem, status: string) {
        if (status === "deleted") return item.deletedAt
        if (status === "removed") return item.removedAt ?? item.moderatedAt
        if (status === "hidden") return item.moderatedAt
        if (status === "ended" || status === "expired") return item.endsAt
        return null
    }

    function getOwnerDateLabel(status: string) {
        if (status === "deleted") return a.moderation.dateDeleted
        if (status === "removed") return a.moderation.dateRemoved
        if (status === "hidden") return a.moderation.dateModerated
        if (status === "expired") return a.moderation.dateExpired
        if (status === "ended") return a.moderation.dateEnded
        return a.moderation.date
    }

    function renderAdPromotionStatus(ad: Ad) {
        const isPinActive =
            !!ad.pinType &&
            typeof ad.pinnedUntil === "number" &&
            ad.pinnedUntil > now

        const isInQueue =
            !isPinActive &&
            !!ad.pinType &&
            typeof ad.pinQueueAt === "number" &&
            (!ad.pinnedUntil || ad.pinnedUntil <= now)

        const isHighlightActive =
            !!ad.highlightUntil &&
            ad.highlightUntil > now

        if (!isPinActive && !isInQueue && !isHighlightActive) return null

        const promotionType = ad.pinType === "top3" ? "TOP 3" : "TOP 6"

        return (
            <div className="stack8" style={{ fontSize: 13, color: "#374151" }}>
                {isPinActive && ad.pinnedUntil && (
                    <div>
                        {a.myAds.topActive
                            .replace("{{type}}", promotionType)
                            .replace("{{date}}", new Date(ad.pinnedUntil).toLocaleDateString(a.chats.timeLocale))}
                    </div>
                )}

                {isInQueue && ad.pinQueueAt && (
                    <div style={{ color: "#4b5563" }}>
                        <b>{a.myAds.topQueue.replace("{{type}}", promotionType)}</b>
                        <br />
                        {a.myAds.queuedAt.replace("{{date}}", new Date(ad.pinQueueAt).toLocaleDateString(a.chats.timeLocale))}
                        <br />
                        {a.myAds.queueInfo}
                    </div>
                )}

                {isHighlightActive && ad.highlightUntil && (
                    <div>
                        {a.myAds.highlightActive.replace("{{date}}", new Date(ad.highlightUntil).toLocaleDateString(a.chats.timeLocale))}
                    </div>
                )}
            </div>
        )
    }

    function renderLongText(value?: string | null) {
        const text = value?.trim()
        if (!text) return null
        if (text.length <= 140) return <div>{text}</div>

        return (
            <details>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                    {a.moderation.showDetails}
                </summary>
                <div style={{ marginTop: 6 }}>{text}</div>
            </details>
        )
    }

    function renderCompactOwnerItem(
        item: ModeratedOwnerItem,
        status: string,
        to: string
    ) {
        const date = formatOwnerDate(getOwnerStatusDate(item, status))
        const showSupport = status === "hidden" || status === "removed"
        const reason = item.moderationReason || item.ownerNotificationMessage

        return (
            <div
                key={to}
                className="stack8"
                style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: 12,
                    background: "#fff",
                    fontSize: 14,
                }}
            >
                <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
                    <Link to={to} style={{ color: "inherit", fontWeight: 700 }}>
                        {item.title}
                    </Link>
                    <span className="ad-badge">{getOwnerStatusLabel(status)}</span>
                </div>

                {(item.city || item.voivodeship) && (
                    <div style={{ color: "#6b7280" }}>
                        {[item.city, item.voivodeship].filter(Boolean).join(" · ")}
                    </div>
                )}

                {date && (
                    <div style={{ color: "#6b7280" }}>
                        {getOwnerDateLabel(status)}: {date}
                    </div>
                )}

                {status !== "deleted" && reason && (
                    <div className="stack8">
                        <b>{a.moderation.reason}:</b>
                        {renderLongText(reason)}
                    </div>
                )}

                {showSupport && (
                    <div style={{ color: "#78350f" }}>
                        {a.moderation.contactSupport}
                    </div>
                )}
            </div>
        )
    }

    function renderArchiveSection(
        title: string,
        count: number,
        children: ReactNode
    ) {
        if (count === 0) return null

        return (
            <details
                className="stack8"
                style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: 12,
                    background: "#f9fafb",
                }}
            >
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                    {title} ({count})
                </summary>
                <div className="stack8" style={{ marginTop: 10 }}>
                    {children}
                </div>
            </details>
        )
    }

    const [mode, setMode] = useState<AuthMode>("login")


    // ui / auth
    const [isLoading, setIsLoading] = useState(true)
    const [authLoading, setAuthLoading] = useState(false)
    const [authError, setAuthError] = useState<string | null>(null)

    // auth form
    const [nickname, setNickname] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [resetLoading, setResetLoading] = useState(false)
    const [resetMessage, setResetMessage] = useState<string | null>(null)

    // data
    const [user, setUser] = useState<AppUser | null>(null)
    const [profileNickname, setProfileNickname] = useState("")
    const [profileMessage, setProfileMessage] = useState<string | null>(null)
    const [profileError, setProfileError] = useState<string | null>(null)
    const [profileSaving, setProfileSaving] = useState(false)

    const [myAds, setMyAds] = useState<Ad[]>([])
    const [myAuctions, setMyAuctions] = useState<Auction[]>([])

    // contacts (public)
    const [phone, setPhone] = useState("")
    const [telegram, setTelegram] = useState("")
    const [savedPhone, setSavedPhone] = useState("")
    const [savedTelegram, setSavedTelegram] = useState("")
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

        const currentUser: AppUser = u
        const userId = currentUser.id // ✅ фиксируем
        setUser(currentUser)
        setProfileNickname("")

        async function loadContacts() {
            const ref = doc(db, "users", userId)

            const snap = await getDoc(ref)

            if (snap.exists()) {
                const data = snap.data()
                const nextPhone = typeof data.phone === "string" ? data.phone : ""
                const nextTelegram = typeof data.telegram === "string" ? data.telegram : ""
                const nextUser: AppUser = {
                    ...currentUser,
                    nickname: typeof data.nickname === "string" ? data.nickname : currentUser.nickname,
                    status: data.status === "blocked" ? "blocked" : "active",
                    blockedAt: typeof data.blockedAt === "number" ? data.blockedAt : null,
                    blockedReason: typeof data.blockedReason === "string" ? data.blockedReason : null,
                    blockedBy: typeof data.blockedBy === "string" ? data.blockedBy : null,
                    unblockedAt: typeof data.unblockedAt === "number" ? data.unblockedAt : null,
                    unblockReason: typeof data.unblockReason === "string" ? data.unblockReason : null,
                    unblockedBy: typeof data.unblockedBy === "string" ? data.unblockedBy : null,
                    phone: nextPhone || null,
                    telegram: nextTelegram || null,
                }

                setSavedPhone(nextPhone)
                setSavedTelegram(nextTelegram)
                setLocalUser(nextUser)
                setUser(nextUser)
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

    async function handleDeleteAuction(auctionId: string) {
        if (!user) return

        const ok = window.confirm(a.confirms.deleteAuction)
        if (!ok) return

        try {
            const deletedAt = Date.now()
            const deletedBy = user.uid || user.id

            await updateDoc(doc(db, "auctions", auctionId), {
                status: "deleted",
                deletedAt,
                deletedBy,
                deleteReason: "user_deleted",
            })

            setMyAuctions(prev =>
                prev.map(a =>
                    a.id === auctionId
                        ? { ...a, status: "deleted", deletedAt, deletedBy, deleteReason: "user_deleted" }
                        : a
                )
            )
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
            const deletedAt = Date.now()
            const deletedBy = user.uid || user.id

            await updateDoc(doc(db, "ads", adId), {
                status: "deleted",
                deletedAt,
                deletedBy,
                deleteReason: "user_deleted",
            })

            setMyAds(prev =>
                prev.map(ad =>
                    ad.id === adId
                        ? { ...ad, status: "deleted", deletedAt, deletedBy, deleteReason: "user_deleted" }
                        : ad
                )
            )
        } catch (err) {
            console.error(err)
            alert(a.alerts.deleteAdError)
        }
    }


    async function handleSaveProfile() {
        if (!user || !isAdmin()) return

        const nextNickname = profileNickname.trim()
        setProfileMessage(null)
        setProfileError(null)

        if (!nextNickname) {
            setProfileError(a.profile.nicknameRequired)
            return
        }

        try {
            setProfileSaving(true)
            await updateDoc(doc(db, "users", user.id), {
                nickname: nextNickname,
            })

            const nextUser: AppUser = {
                ...user,
                nickname: nextNickname,
            }

            setLocalUser(nextUser)
            setUser(nextUser)
            setProfileNickname("")
            setProfileMessage(a.profile.profileSaved)
        } catch (e) {
            console.error(e)
            setProfileError(a.profile.saveProfileError)
        } finally {
            setProfileSaving(false)
        }
    }


    async function handleSaveContacts() {
        if (!user) return

        try {
            const nextPhone = phone.trim()
            const nextTelegram = telegram.trim()

            await updateDoc(doc(db, "users", user.id), {
                phone: nextPhone || null,
                telegram: nextTelegram || null,
            })

            const nextUser: AppUser = {
                ...user,
                phone: nextPhone || null,
                telegram: nextTelegram || null,
            }

            setLocalUser(nextUser)
            setUser(nextUser)
            setSavedPhone(nextPhone)
            setSavedTelegram(nextTelegram)
            setPhone("")
            setTelegram("")
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
                                    status: profile?.status === "blocked" ? "blocked" : "active",
                                    blockedAt: profile?.blockedAt ?? null,
                                    blockedReason: profile?.blockedReason ?? null,
                                    blockedBy: profile?.blockedBy ?? null,
                                    unblockedAt: profile?.unblockedAt ?? null,
                                    unblockReason: profile?.unblockReason ?? null,
                                    unblockedBy: profile?.unblockedBy ?? null,
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
                                setProfileNickname("")
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
                            setProfileNickname("")

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

    const getAdOwnerStatus = (ad: Ad) => ad.status ?? "active"
    const getAuctionOwnerStatus = (auction: Auction) => {
        const status = auction.status ?? "active"
        if (status === "active" && auction.endsAt <= now) return "ended"
        return status
    }

    const activeAds = myAds.filter(ad => getAdOwnerStatus(ad) === "active")
    const hiddenAds = myAds.filter(ad => getAdOwnerStatus(ad) === "hidden")
    const deletedAds = myAds.filter(ad => getAdOwnerStatus(ad) === "deleted")
    const removedAds = myAds.filter(ad => getAdOwnerStatus(ad) === "removed")
    const expiredAds = myAds.filter(ad => getAdOwnerStatus(ad) === "expired")

    const activeAuctions = myAuctions.filter(auction => (auction.status ?? "active") === "active" && auction.endsAt > now)
    const hiddenAuctions = myAuctions.filter(auction => getAuctionOwnerStatus(auction) === "hidden")
    const deletedAuctions = myAuctions.filter(auction => getAuctionOwnerStatus(auction) === "deleted")
    const removedAuctions = myAuctions.filter(auction => getAuctionOwnerStatus(auction) === "removed")
    const archivedAuctions = myAuctions.filter(auction => ["ended", "expired"].includes(getAuctionOwnerStatus(auction)))
    const canEditProfile = isAdmin()
    const chatBadgeText = chatUnreadCount > 99 ? "99+" : String(chatUnreadCount)
    const isBlockedAccount = user.status === "blocked"


    // ============================
    // PROFILE
    // ============================
    return (
        <div className="stack12">
            {isBlockedAccount && (
                <div
                    className="warning stack8"
                    style={{
                        borderColor: "#f97316",
                        background: "#fff7ed",
                        color: "#9a3412",
                        fontSize: 14,
                    }}
                >
                    <b>{a.profile.blockedTitle}</b>
                    <div>{a.profile.blockedMessage}</div>
                    <div>{a.profile.blockedSupport}</div>
                </div>
            )}

            <div className="card stack8">
                <h2 className="h2">{user.nickname}</h2>
                <div style={{fontSize: 14, color: "#6b7280"}}>{user.email}</div>
                {canEditProfile ? (
                    <div className="card stack8">
                        <h3 className="h3">{a.profile.editProfile}</h3>
                        <label style={{fontSize: 13, fontWeight: 700}}>
                            {a.profile.nicknameLabel}
                        </label>
                        <input
                            className="input"
                            type="text"
                            placeholder={user.nickname}
                            value={profileNickname}
                            onChange={e => {
                                setProfileNickname(e.target.value)
                                setProfileMessage(null)
                                setProfileError(null)
                            }}
                        />
                        {profileError && (
                            <div style={{fontSize: 13, color: "#b91c1c"}}>
                                {profileError}
                            </div>
                        )}
                        {profileMessage && (
                            <div style={{fontSize: 13, color: "#15803d"}}>
                                {profileMessage}
                            </div>
                        )}
                        <button
                            className="btn-primary"
                            type="button"
                            disabled={profileSaving}
                            onClick={handleSaveProfile}
                        >
                            {a.profile.save}
                        </button>
                    </div>
                ) : null}
                <Link
                    to="/account/chats"
                    className="btn-secondary"
                    style={{display: "inline-block", textAlign: "center", position: "relative"}}
                >
                    {a.profile.myChats}
                    {chatUnreadCount > 0 && (
                        <span
                            style={{
                                position: "absolute",
                                top: -8,
                                right: -8,
                                minWidth: 22,
                                height: 22,
                                padding: "0 6px",
                                borderRadius: 999,
                                background: "#dc2626",
                                color: "#fff",
                                fontSize: 11,
                                fontWeight: 800,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                border: "2px solid #fff",
                            }}
                        >
                            {chatBadgeText}
                        </span>
                    )}
                </Link>
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

                    {(savedPhone || savedTelegram) && (
                        <div
                            className="stack8"
                            style={{
                                border: "1px solid #d1fae5",
                                borderRadius: 8,
                                padding: 10,
                                background: "#f0fdf4",
                                fontSize: 14,
                            }}
                        >
                            <b>{a.profile.savedContacts}</b>
                            {savedPhone && (
                                <div>
                                    {a.profile.phoneLabel}: {savedPhone}
                                </div>
                            )}
                            {savedTelegram && (
                                <div>
                                    {a.profile.telegramLabel}: {savedTelegram}
                                </div>
                            )}
                        </div>
                    )}

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
                        {a.profile.saved}
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

                            const nextUser: AppUser = {
                                ...user,
                                phone: null,
                                telegram: null,
                            }

                            setLocalUser(nextUser)
                            setUser(nextUser)
                            setPhone("")
                            setTelegram("")
                            setSavedPhone("")
                            setSavedTelegram("")
                            setContactsSaved(false)
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
                        setProfileNickname("")
                        setProfileMessage(null)
                        setProfileError(null)
                        setSavedPhone("")
                        setSavedTelegram("")
                        setPhone("")
                        setTelegram("")
                        setMyAds([])
                        setMyAuctions([])
                    }}
                >
                    {a.profile.logout}
                </button>
            </div>

            <div className="card stack12">
                <h3 className="h3">{a.myAds.title}</h3>

                {activeAds.length === 0 ? (
                    <div style={{color: "#6b7280", fontSize: 14}}>
                        {myAds.length === 0 ? a.myAds.empty : a.myAds.emptyActive}
                    </div>

                ) : (
                    <div className="ads-grid">
                    {activeAds.map(ad => (
                            <div key={ad.id} className="stack8">
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

                                {renderAdPromotionStatus(ad)}

                            </div>
                        ))}


                    </div>
                )}

                {renderArchiveSection(
                    a.moderation.sections.hidden,
                    hiddenAds.length,
                    hiddenAds.map(ad => renderCompactOwnerItem(ad, "hidden", buildAdPath(ad.title, ad.city, ad.id)))
                )}
                {renderArchiveSection(
                    a.moderation.sections.deleted,
                    deletedAds.length,
                    deletedAds.map(ad => renderCompactOwnerItem(ad, "deleted", buildAdPath(ad.title, ad.city, ad.id)))
                )}
                {renderArchiveSection(
                    a.moderation.sections.removed,
                    removedAds.length,
                    removedAds.map(ad => renderCompactOwnerItem(ad, "removed", buildAdPath(ad.title, ad.city, ad.id)))
                )}
                {renderArchiveSection(
                    a.moderation.sections.archivedAds,
                    expiredAds.length,
                    expiredAds.map(ad => renderCompactOwnerItem(ad, "expired", buildAdPath(ad.title, ad.city, ad.id)))
                )}
            </div>

            {/* MY AUCTIONS */}
            <div className="card stack12">
                <h3 className="h3">{a.myAuctions.title}</h3>

                {activeAuctions.length === 0 ? (
                    <div style={{color: "#6b7280", fontSize: 14}}>
                        {myAuctions.length === 0 ? a.myAuctions.empty : a.myAuctions.emptyActive}
                    </div>

                ) : (
                    <div className="stack12">
                    {activeAuctions.map((auction: Auction) => {

                            const isEnded = auction.endsAt <= now

                            return (
                                <div key={auction.id} className="stack8">
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

                {renderArchiveSection(
                    a.moderation.sections.hidden,
                    hiddenAuctions.length,
                    hiddenAuctions.map(auction => renderCompactOwnerItem(auction, "hidden", buildAuctionPath(auction.title, auction.city, auction.id)))
                )}
                {renderArchiveSection(
                    a.moderation.sections.deleted,
                    deletedAuctions.length,
                    deletedAuctions.map(auction => renderCompactOwnerItem(auction, "deleted", buildAuctionPath(auction.title, auction.city, auction.id)))
                )}
                {renderArchiveSection(
                    a.moderation.sections.removed,
                    removedAuctions.length,
                    removedAuctions.map(auction => renderCompactOwnerItem(auction, "removed", buildAuctionPath(auction.title, auction.city, auction.id)))
                )}
                {renderArchiveSection(
                    a.moderation.sections.archivedAuctions,
                    archivedAuctions.length,
                    archivedAuctions.map(auction => {
                        const status = getAuctionOwnerStatus(auction)
                        return renderCompactOwnerItem(auction, status, buildAuctionPath(auction.title, auction.city, auction.id))
                    })
                )}
            </div>
        </div>
    )
}

export default AccountPage
