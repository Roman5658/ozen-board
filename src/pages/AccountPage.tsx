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

import { getLocalUser, setLocalUser, clearLocalUser } from "../data/localUser"
import type { Auction } from "../types/auction"
import AdCard from "../components/AdCard"
import AuctionCard from "../components/AuctionCard"
import { buildAdPath, buildAuctionPath } from '../utils/slug'
import { getPasswordValidationIssue } from "../utils/passwordPolicy"
import { isReservedAdminNickname, isValidNickname } from "../utils/nicknameSecurity"
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
                <summary className="account-owner-item__summary">
                    {a.moderation.showDetails}
                </summary>
                <div className="account-owner-item__reason-text">{text}</div>
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
                className="account-owner-item"
            >
                <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
                    <Link to={to} className="account-owner-item__link">
                        {item.title}
                    </Link>
                    <span className="listing-badge">{getOwnerStatusLabel(status)}</span>
                </div>

                {(item.city || item.voivodeship) && (
                    <div className="account-owner-item__meta">
                        {[item.city, item.voivodeship].filter(Boolean).join(" · ")}
                    </div>
                )}

                {date && (
                    <div className="account-owner-item__meta">
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
                    <div className="account-owner-item__support">
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
            <details className="account-archive">
                <summary className="account-archive__summary">
                    {title} ({count})
                </summary>
                <div className="account-archive__items">
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
    const [myAds, setMyAds] = useState<Ad[]>([])
    const [myAdsLoaded, setMyAdsLoaded] = useState(false)
    const [myAdsLoading, setMyAdsLoading] = useState(false)
    const [myAdsError, setMyAdsError] = useState(false)
    const [myAuctions, setMyAuctions] = useState<Auction[]>([])
    const [myAuctionsLoaded, setMyAuctionsLoaded] = useState(false)
    const [myAuctionsLoading, setMyAuctionsLoading] = useState(false)
    const [myAuctionsError, setMyAuctionsError] = useState(false)

    // contacts (public)
    const [savedPhone, setSavedPhone] = useState("")
    const [savedTelegram, setSavedTelegram] = useState("")
    const [contactsLoading, setContactsLoading] = useState(false)
    const [contactsLoadError, setContactsLoadError] = useState(false)




    async function loadUserContacts(currentUser: AppUser) {
        setContactsLoading(true)
        setContactsLoadError(false)
        try {
            const snap = await getDoc(doc(db, "users", currentUser.id))
            if (getLocalUser()?.id !== currentUser.id) return
            if (!snap.exists()) {
                setSavedPhone("")
                setSavedTelegram("")
                return
            }

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
        } catch (error) {
            console.error("[account] failed to load contacts", error)
            setContactsLoadError(true)
        } finally {
            setContactsLoading(false)
        }
    }

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
        setUser(currentUser)
        void loadUserContacts(currentUser).finally(() => setIsLoading(false))
    }, [])





    async function loadMyAds() {
        if (!user || myAdsLoaded || myAdsLoading) return
        const userId = user.id
        setMyAdsLoading(true)
        setMyAdsError(false)

        try {
            const snap = await getDocs(query(collection(db, "ads"), where("userId", "==", userId)))
            if (getLocalUser()?.id !== userId) return
            setMyAds(snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as Omit<Ad, "id">),
            })))
            setMyAdsLoaded(true)
        } catch (error) {
            console.error("[account] failed to load ads", error)
            setMyAdsError(true)
        } finally {
            setMyAdsLoading(false)
        }
    }

    async function loadMyAuctions() {
        if (!user || myAuctionsLoaded || myAuctionsLoading) return
        const userId = user.id
        setMyAuctionsLoading(true)
        setMyAuctionsError(false)

        try {
            const snap = await getDocs(query(collection(db, "auctions"), where("ownerId", "==", userId)))
            if (getLocalUser()?.id !== userId) return
            setMyAuctions(snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as Omit<Auction, "id">),
            })))
            setMyAuctionsLoaded(true)
        } catch (error) {
            console.error("[account] failed to load auctions", error)
            setMyAuctionsError(true)
        } finally {
            setMyAuctionsLoading(false)
        }
    }

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


    function handleLogout() {
        clearLocalUser()
        setUser(null)
        setSavedPhone("")
        setSavedTelegram("")
        setContactsLoadError(false)
        setMyAds([])
        setMyAdsLoaded(false)
        setMyAdsError(false)
        setMyAuctions([])
        setMyAuctionsLoaded(false)
        setMyAuctionsError(false)
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
            <div className="card stack16 account-auth">
                <h2 className="h2">{a.title}</h2>

                <div className="account-auth__tabs" role="group" aria-label={a.title}>
                    <button
                        className={`account-auth__tab${mode === "login" ? " is-active" : ""}`}
                        type="button"
                        aria-pressed={mode === "login"}
                        onClick={() => setMode("login")}
                    >
                        {a.auth.loginTab}
                    </button>

                    <button
                        className={`account-auth__tab${mode === "register" ? " is-active" : ""}`}
                        type="button"
                        aria-pressed={mode === "register"}
                        onClick={() => setMode("register")}
                    >
                        {a.auth.registerTab}
                    </button>
                </div>

                {mode === "register" && (
                    <label className="stack4 account-field" htmlFor="account-nickname">
                        <span>{a.auth.nicknamePlaceholder}</span>
                        <input
                            className="input"
                            id="account-nickname"
                            autoComplete="nickname"
                            value={nickname}
                            maxLength={80}
                            onChange={e => setNickname(e.target.value)}
                        />
                    </label>
                )}

                <label className="stack4 account-field" htmlFor="account-email">
                    <span>{a.auth.emailPlaceholder}</span>
                    <input
                        className="input"
                        id="account-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                    />
                </label>

                <label className="stack4 account-field" htmlFor="account-password">
                    <span>{a.auth.passwordPlaceholder}</span>
                    <input
                        className="input"
                        id="account-password"
                        type="password"
                        autoComplete={mode === "login" ? "current-password" : "new-password"}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                    />
                </label>
                {password && getPasswordValidationIssue(password, mode) && (
                    <div style={{ color: "#b91c1c", fontSize: 13 }}>
                        {getPasswordValidationIssue(password, mode) === "too-short"
                            ? a.auth.errors.passwordTooShort
                            : getPasswordValidationIssue(password, mode) === "too-long"
                                ? a.auth.errors.passwordTooLong
                                : getPasswordValidationIssue(password, mode) === "control-character"
                                    ? a.auth.errors.passwordControlChars
                                    : a.auth.errors.passwordRequired}
                    </div>
                )}
                {mode === "login" && (
                    <button
                        type="button"
                        className="btn-secondary account-auth__forgot"
                        disabled={resetLoading}
                        onClick={async () => {
                            setAuthError(null)
                            setResetMessage(null)

                            const cleanEmail = email.trim().toLowerCase()
                            if (!cleanEmail) {
                                setAuthError(a.auth.errors.emailRequired)
                                return
                            }

                            try {
                                setResetLoading(true)
                                await sendPasswordResetEmail(auth, cleanEmail)
                                setResetMessage(a.auth.passwordResetSent)
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            } catch (error: any) {
                                const code = error?.code as string | undefined
                                if (code === "auth/invalid-email") {
                                    setAuthError(a.auth.errors.invalidEmail)
                                } else if (code === "auth/user-not-found") {
                                    setAuthError(a.auth.errors.userNotFound)
                                } else if (code === "auth/too-many-requests") {
                                    setAuthError(a.auth.errors.tooManyRequests)
                                } else {
                                    setAuthError(a.auth.errors.passwordResetFailed)
                                }
                            } finally {
                                setResetLoading(false)
                            }
                        }}
                    >
                        {resetLoading ? a.auth.passwordResetLoading : a.auth.forgotPassword}
                    </button>
                )}

                {resetMessage && (
                    <div role="status" className="account-message account-message--success">
                        {resetMessage}
                    </div>
                )}

                {authError && (
                    <div role="alert" className="account-message account-message--error">
                        {authError}
                    </div>
                )}

                <button
                    className="btn-primary account-auth__submit"
                    disabled={
                        authLoading ||
                        !password ||
                        (mode === "register" && !nickname.trim())
                    }
                    onClick={async () => {
                        setAuthError(null)
                        const passwordIssue = getPasswordValidationIssue(password, mode)
                        if (passwordIssue) {
                            setAuthError(passwordIssue === "too-short"
                                ? a.auth.errors.passwordTooShort
                                : passwordIssue === "too-long"
                                    ? a.auth.errors.passwordTooLong
                                    : passwordIssue === "control-character"
                                        ? a.auth.errors.passwordControlChars
                                        : a.auth.errors.passwordRequired)
                            return
                        }
                        setAuthLoading(true)
                        const mapAuthError = (code?: string) => {
                            if (code === "auth/email-already-in-use") return a.auth.errors.emailTaken
                            if (code === "auth/invalid-email") return a.auth.errors.invalidEmail
                            if (code === "auth/user-not-found") return a.auth.errors.userNotFound
                            if (code === "auth/wrong-password") return a.auth.errors.wrongPassword
                            if (code === "auth/invalid-credential") return a.auth.errors.invalidCredential
                            if (code === "auth/weak-password") return a.auth.errors.weakPassword
                            if (code === "auth/too-many-requests") return a.auth.errors.tooManyRequests
                            return a.auth.errors.genericAuthError
                        }
                        try {
                            const cleanEmail = email.trim().toLowerCase()
                            // ===== LOGIN =====
                            if (!cleanEmail) {
                                setAuthError(a.auth.errors.emailRequired)
                                return
                            }
                            if (!cleanEmail.includes("@")) {
                                setAuthError(a.auth.errors.invalidEmail)
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
                                if (isReservedAdminNickname(nickname)) {
                                    setAuthError(a.auth.errors.nicknameReserved)
                                    return
                                }
                                if (!isValidNickname(nickname)) {
                                    setAuthError(a.auth.errors.nicknameTooLong)
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

                                const savedPhoneValue = typeof profile?.phone === "string" ? profile.phone : ""
                                const savedTelegramValue = typeof profile?.telegram === "string" ? profile.telegram : ""
                                setSavedPhone(savedPhoneValue)
                                setSavedTelegram(savedTelegramValue)
                                setContactsLoadError(false)

                                if (!profile || profile.uid !== authRes.user.uid) {
                                    await createUser(mergedUser)
                                }

                                // сохраняем сессию
                                setLocalUser(mergedUser)
                                setUser(mergedUser)
                                setPassword("")
                                return
                            }


                            // ===== REGISTER =====
                            // ===== REGISTER =====
                            const nicknameTaken = await isNicknameTaken(nickname)
                            if (nicknameTaken) {
                                setAuthError(a.auth.errors.nicknameTaken)
                                return
                            }

                            const authRes = await createUserWithEmailAndPassword(auth, cleanEmail, password)
                            await authRes.user.getIdToken(true)
                            const newUser: AppUser = {
                                id: cleanEmail,
                                uid: authRes.user.uid,
                                nickname: nickname.trim(),
                                email: cleanEmail,
                                status: "active",
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
                            console.error(`[auth] ${mode === "register" ? "registration" : "login"} failed`, error?.code ?? "unknown")
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
    const chatBadgeText = chatUnreadCount > 99 ? "99+" : String(chatUnreadCount)
    const isBlockedAccount = user.status === "blocked"


    // ============================
    // PROFILE
    // ============================
    return (
        <div className="account-page">
            <h2 className="account-page__title">{a.title}</h2>
            {isBlockedAccount && (
                <div className="account-blocked-warning" role="alert">
                    <b>{a.profile.blockedTitle}</b>
                    <div>{a.profile.blockedMessage}</div>
                    <div>{a.profile.blockedSupport}</div>
                </div>
            )}

            <div className="account-overview-grid">
            <section className="card account-card account-profile" aria-labelledby="account-profile-heading">
                <div className="account-profile__heading">
                    <div className="account-profile__identity">
                        <h3 className="account-card__title" id="account-profile-heading">{user.nickname}</h3>
                        <div className="account-profile__email">{user.email}</div>
                    </div>
                    <span className={`account-status${isBlockedAccount ? " account-status--blocked" : ""}`}>
                        {isBlockedAccount ? a.profile.blockedTitle : a.moderation.statusActive}
                    </span>
                </div>
                <div className="account-profile__actions">
                    <Link to="/account/edit-profile" className="btn-secondary account-action-link">
                        {a.profile.editProfile}
                    </Link>
                    <Link to="/account/chats" className="btn-secondary account-action-link">
                        <span>{a.profile.myChats}</span>
                        {chatUnreadCount > 0 && <span className="account-chat-badge">{chatBadgeText}</span>}
                    </Link>
                    <Link to="/account/payments" className="btn-secondary account-action-link">
                        {a.payments.link}
                    </Link>
                    <button type="button" className="btn-secondary account-action-link" onClick={handleLogout}>
                        {a.profile.logout}
                    </button>
                </div>
            </section>

            <section className="account-card account-contacts" aria-labelledby="account-contacts-heading" aria-busy={contactsLoading}>
                    <h3 className="account-card__title" id="account-contacts-heading">{a.profile.contactsTitle}</h3>

                    <div className="account-contact-warning" role="note">
                        {a.profile.contactsWarn}
                    </div>

                    {contactsLoadError && (
                        <div className="account-message account-message--error" role="alert">
                            <span>{a.profile.contactsLoadError}</span>
                            <button type="button" className="account-inline-retry" onClick={() => {
                                if (user) void loadUserContacts(user)
                            }}>
                                {a.profile.retry}
                            </button>
                        </div>
                    )}
                    {contactsLoading && <div className="account-message" role="status">{a.loading}</div>}

                    {!contactsLoading && !contactsLoadError && (
                        <div className="account-saved-contacts">
                            <b>{a.profile.savedContacts}</b>
                            <div>{a.profile.phoneLabel}: {savedPhone || "—"}</div>
                            <div>{a.profile.telegramLabel}: {savedTelegram || "—"}</div>
                        </div>
                    )}
                </section>
            </div>

            <details className="card account-section" id="account-ads" onToggle={(event) => {
                if (event.currentTarget.open) void loadMyAds()
            }}>
                <summary className="account-section__summary">
                    <span>{a.myAds.title}</span>
                    {myAdsLoaded && <span className="account-section__count">{myAds.length}</span>}
                </summary>
                <div className="account-section__content" aria-busy={myAdsLoading}>
                    {myAdsLoading && <div className="account-section__state" role="status">{a.myAds.loading}</div>}
                    {myAdsError && (
                        <div className="account-section__state" role="alert">
                            <span>{a.myAds.loadError}</span>
                            <button type="button" className="btn-secondary account-retry" onClick={() => void loadMyAds()}>{a.myAds.retry}</button>
                        </div>
                    )}
                    {!myAdsLoaded && !myAdsLoading && !myAdsError && (
                        <div className="account-section__state" role="status">{a.myAds.loading}</div>
                    )}
                    {myAdsLoaded && !myAdsError && <>
                        {activeAds.length === 0 ? (
                            <div className="account-empty-state">
                                {myAds.length === 0 ? a.myAds.empty : a.myAds.emptyActive}
                            </div>
                        ) : (
                            <div className="ads-grid account-ads-grid">
                                {activeAds.map(ad => (
                                    <div key={ad.id} className="stack8">
                                        <Link to={buildAdPath(ad.title, ad.city, ad.id)} className="account-ad-link">
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
                    </>}
                </div>
            </details>

            <details className="card account-section" id="account-auctions" onToggle={(event) => {
                if (event.currentTarget.open) void loadMyAuctions()
            }}>
                <summary className="account-section__summary">
                    <span>{a.myAuctions.title}</span>
                    {myAuctionsLoaded && <span className="account-section__count">{myAuctions.length}</span>}
                </summary>
                <div className="account-section__content" aria-busy={myAuctionsLoading}>
                    {myAuctionsLoading && <div className="account-section__state" role="status">{a.myAuctions.loading}</div>}
                    {myAuctionsError && (
                        <div className="account-section__state" role="alert">
                            <span>{a.myAuctions.loadError}</span>
                            <button type="button" className="btn-secondary account-retry" onClick={() => void loadMyAuctions()}>{a.myAuctions.retry}</button>
                        </div>
                    )}
                    {!myAuctionsLoaded && !myAuctionsLoading && !myAuctionsError && (
                        <div className="account-section__state" role="status">{a.myAuctions.loading}</div>
                    )}
                    {myAuctionsLoaded && !myAuctionsError && <>
                        {activeAuctions.length === 0 ? (
                            <div className="account-empty-state">
                                {myAuctions.length === 0 ? a.myAuctions.empty : a.myAuctions.emptyActive}
                            </div>
                        ) : (
                            <div className="account-auction-list">
                                {activeAuctions.map((auction: Auction) => {
                                    const isEnded = auction.endsAt <= now
                                    return (
                                        <div key={auction.id} className="account-auction-row">
                                            <AuctionCard
                                                t={t}
                                                title={auction.title}
                                                city={auction.city}
                                                currentBid={auction.startPrice}
                                                timeLeft={isEnded
                                                    ? a.myAuctions.ended
                                                    : `${Math.ceil((auction.endsAt - now) / 60000)} ${a.myAuctions.minutesShort}`}
                                                image={auction.images?.[0]}
                                                ownerName={auction.ownerNickname?.trim() || auction.ownerName?.trim() || user.nickname}
                                                isEnded={isEnded}
                                            />
                                            {isEnded && <div className="account-auction-row__ended">{a.myAuctions.endedInfo}</div>}
                                            <div className="account-auction-row__actions">
                                                <button type="button" className="btn-secondary account-row-button" onClick={() => navigate(buildAuctionPath(auction.title, auction.city, auction.id))}>
                                                    {a.myAuctions.goTo}
                                                </button>
                                                <button type="button" className="btn-danger account-row-button" onClick={() => handleDeleteAuction(auction.id)}>
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
                    </>}
                </div>
            </details>
        </div>
    )
}

export default AccountPage
