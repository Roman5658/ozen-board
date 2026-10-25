import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { doc, getDoc, updateDoc } from "firebase/firestore"
import type { translations } from "../app/i18n"
import { db } from "../app/firebase"
import { clearLocalUser, getLocalUser, isAdmin, setLocalUser } from "../data/localUser"
import type { AppUser } from "../types/user"
import { isReservedAdminNickname, isValidNickname } from "../utils/nicknameSecurity"

type Props = { t: (typeof translations)[keyof typeof translations] }

function EditProfilePage({ t }: Props) {
    const a = t.account
    const [user, setUser] = useState<AppUser | null>(null)
    const [nickname, setNickname] = useState("")
    const [phone, setPhone] = useState("")
    const [telegram, setTelegram] = useState("")
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState(false)
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const canEditNickname = isAdmin()

    useEffect(() => {
        let cancelled = false

        async function loadProfile() {
            const currentUser = getLocalUser()
            if (!currentUser?.id || !currentUser.email) {
                clearLocalUser()
                if (!cancelled) setLoading(false)
                return
            }

            setUser(currentUser)
            try {
                const snapshot = await getDoc(doc(db, "users", currentUser.id))
                if (cancelled || getLocalUser()?.id !== currentUser.id) return
                const data = snapshot.exists() ? snapshot.data() : {}
                setNickname(typeof data.nickname === "string" ? data.nickname : currentUser.nickname)
                setPhone(typeof data.phone === "string" ? data.phone : "")
                setTelegram(typeof data.telegram === "string" ? data.telegram : "")
            } catch (loadFailure) {
                console.error("[account profile] failed to load profile", loadFailure)
                if (!cancelled) setLoadError(true)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void loadProfile()
        return () => { cancelled = true }
    }, [])

    async function handleSave(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!user || loading || loadError || saving) return

        const nextNickname = nickname.trim()
        if (canEditNickname && !nextNickname) {
            setError(a.profile.nicknameRequired)
            setMessage(null)
            return
        }
        if (canEditNickname && !isValidNickname(nextNickname)) {
            setError(isReservedAdminNickname(nextNickname)
                ? a.auth.errors.nicknameReserved
                : nextNickname.length > 80
                    ? a.auth.errors.nicknameTooLong
                    : a.auth.errors.nicknameLatinOnly)
            setMessage(null)
            return
        }

        setSaving(true)
        setError(null)
        setMessage(null)
        try {
            const updates: { phone: string | null; telegram: string | null; nickname?: string } = {
                phone: phone.trim() || null,
                telegram: telegram.trim() || null,
            }
            if (canEditNickname && nextNickname !== user.nickname) updates.nickname = nextNickname

            await updateDoc(doc(db, "users", user.id), updates)
            const nextUser: AppUser = {
                ...user,
                ...(updates.nickname ? { nickname: updates.nickname } : {}),
                phone: updates.phone,
                telegram: updates.telegram,
            }
            setLocalUser(nextUser)
            setUser(nextUser)
            setPhone(nextUser.phone ?? "")
            setTelegram(nextUser.telegram ?? "")
            setNickname(nextUser.nickname)
            setMessage(a.profile.saved)
        } catch (saveFailure) {
            console.error("[account profile] failed to save profile", saveFailure)
            setError(a.alerts.saveContactsError)
        } finally {
            setSaving(false)
        }
    }

    async function handleDeleteContacts() {
        if (!user || loading || loadError || saving || !window.confirm(a.confirms.deleteContacts)) return
        setSaving(true)
        setError(null)
        setMessage(null)
        try {
            await updateDoc(doc(db, "users", user.id), { phone: null, telegram: null })
            const nextUser: AppUser = { ...user, phone: null, telegram: null }
            setLocalUser(nextUser)
            setUser(nextUser)
            setPhone("")
            setTelegram("")
            setMessage(a.alerts.contactsDeleted)
        } catch (deleteFailure) {
            console.error("[account profile] failed to delete contacts", deleteFailure)
            setError(a.alerts.deleteContactsError)
        } finally {
            setSaving(false)
        }
    }

    return (
        <main className="account-page">
            <Link to="/account" className="account-profile-editor__back">{a.profile.backToAccount}</Link>
            <h1 className="account-page__title">{a.profile.editProfile}</h1>

            {!user && !loading && (
                <section className="card account-profile-editor" role="status">
                    <p>{a.profile.authRequired}</p>
                    <Link to="/account" className="btn-primary">{a.title}</Link>
                </section>
            )}
            {loading && <div className="card account-profile-editor" role="status">{a.loading}</div>}
            {user && (
                <form className="card account-profile-editor" onSubmit={handleSave} aria-busy={saving || loading}>
                    {loadError ? (
                        <div className="account-message account-message--error" role="alert">
                            <span>{a.profile.contactsLoadError}</span>
                            <button type="button" className="account-inline-retry" onClick={() => window.location.reload()}>
                                {a.profile.retry}
                            </button>
                        </div>
                    ) : (
                        <>
                            {canEditNickname && (
                                <label className="account-field" htmlFor="edit-profile-nickname">
                                    <span>{a.profile.nicknameLabel}</span>
                                    <input
                                        id="edit-profile-nickname"
                                        className="input"
                                        value={nickname}
                                        maxLength={80}
                                        onChange={(event) => setNickname(event.target.value)}
                                        disabled={loading || saving}
                                    />
                                </label>
                            )}
                            <div className="account-profile-editor__identity">
                                <span>{user.nickname}</span>
                                <span>{user.email}</span>
                            </div>
                            <div className="account-contact-warning" role="note">{a.profile.contactsWarn}</div>
                            <label className="account-field" htmlFor="edit-profile-phone">
                                <span>{a.profile.phoneLabel}</span>
                                <input
                                    id="edit-profile-phone"
                                    className="input"
                                    type="tel"
                                    autoComplete="tel"
                                    placeholder={a.profile.phonePlaceholder}
                                    value={phone}
                                    onChange={(event) => setPhone(event.target.value)}
                                    disabled={loading || saving}
                                />
                            </label>
                            <label className="account-field" htmlFor="edit-profile-telegram">
                                <span>{a.profile.telegramLabel}</span>
                                <input
                                    id="edit-profile-telegram"
                                    className="input"
                                    autoComplete="off"
                                    placeholder={a.profile.telegramPlaceholder}
                                    value={telegram}
                                    onChange={(event) => setTelegram(event.target.value)}
                                    disabled={loading || saving}
                                />
                            </label>
                            {error && <div className="account-message account-message--error" role="alert">{error}</div>}
                            {message && <div className="account-message account-message--success" role="status">{message}</div>}
                            <div className="account-contact-actions">
                                <button type="submit" className="btn-primary" disabled={loading || saving}>
                                    {saving ? a.profile.saving : a.profile.save}
                                </button>
                                <button type="button" className="btn-danger" onClick={() => void handleDeleteContacts()} disabled={loading || saving}>
                                    {a.profile.deleteContacts}
                                </button>
                            </div>
                        </>
                    )}
                </form>
            )}
        </main>
    )
}

export default EditProfilePage
