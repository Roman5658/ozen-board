
import { useParams, useNavigate } from "react-router-dom"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { getLocalUser } from "../data/localUser"
import {
    sendMessage,
    subscribeToChatMessages,
    markChatAsRead,
    getChatUsers,
} from "../data/chats"
import { getUserPublicNickname, getUserPublicNicknames } from "../data/usersPublic"
import { isAccountRestrictedError } from "../data/users"
import { auth, db } from "../app/firebase"
import { DEFAULT_LANG, translations } from "../app/i18n"
import type { Lang } from "../app/i18n"
import { useCallback, useEffect, useState } from "react"

type ChatMessage = {
    id: string
    senderId: string
    text: string
    senderType?: "user" | "system"
    senderName?: string
    createdAt?: unknown
}

function ChatPage() {
    const { id: chatId } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const currentUser = getLocalUser()
    const lang = (localStorage.getItem("lang") as Lang) || DEFAULT_LANG
    const t = translations[lang]

    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [senderNamesById, setSenderNamesById] = useState<Record<string, string>>({})
    const [text, setText] = useState("")
    const [loading, setLoading] = useState(true)
    const [sending, setSending] = useState(false)

    const [otherUserId, setOtherUserId] = useState<string>("")
    const [otherNickname, setOtherNickname] = useState<string>("")
    const [lastSentAt, setLastSentAt] = useState<number>(0)
    const [sendError, setSendError] = useState<string>("")
    const [reportingMessageId, setReportingMessageId] = useState<string>("")


    const currentIds = currentUser
        ? [currentUser.id, currentUser.uid, currentUser.email].filter(Boolean)
        : []

    const isCurrentUserId = useCallback((value: string) => {
        if (!currentUser) return false
        return [currentUser.id, currentUser.uid, currentUser.email].filter(Boolean).includes(value)
    }, [currentUser])


    // ===== подписка на сообщения =====
    useEffect(() => {
        if (!chatId) return

        setLoading(true)

        const unsubscribe = subscribeToChatMessages(chatId, (data) => {
            setMessages(data)
            setLoading(false)
        })

        return () => unsubscribe()
    }, [chatId])

    // ===== пометить чат прочитанным =====
    useEffect(() => {
        if (!chatId || !currentUser) return
        markChatAsRead(chatId, currentUser.id, currentUser.uid, currentUser.email)
    }, [chatId, currentUser])

    // ===== определить собеседника =====
    useEffect(() => {
        if (!currentUser || !chatId) return

            ;(async () => {
            try {
                const users = await getChatUsers(chatId)
                const otherId = users.find(id => !isCurrentUserId(id)) || ""
                setOtherUserId(otherId)

                if (!otherId) return

                const nick = await getUserPublicNickname(otherId, t.common.user)
                setOtherNickname(nick || t.common.user)
            } catch (e) {
                console.error("[chat] failed to resolve other user", e)
            }
        })()
    }, [chatId, currentUser, isCurrentUserId, t.common.user])

    useEffect(() => {
        const missingSenderIds = messages
            .filter(message => message.senderType !== "system")
            .filter(message => !message.senderName)
            .map(message => message.senderId)
            .filter(id => id && !isCurrentUserId(id) && !senderNamesById[id])

        if (missingSenderIds.length === 0) return

        getUserPublicNicknames(missingSenderIds, t.common.user)
            .then(names => setSenderNamesById(prev => ({ ...prev, ...names })))
            .catch(error => console.warn("[chat] failed to load sender names", error))
    }, [isCurrentUserId, messages, senderNamesById, t.common.user])

    // ===== guards =====
    if (!currentUser) {
        return <div className="card">Увійдіть, щоб користуватися чатом</div>
    }

    if (typeof chatId !== "string") {
        return <div className="card">Чат не знайдено</div>
    }

    async function reportMessage(message: ChatMessage, senderName: string) {
        if (!currentUser || !chatId) return

        const authUser = auth.currentUser
        if (!authUser) {
            alert(t.chatReport.authRequired)
            return
        }

        const reportedBy = authUser.uid
        const reportId = `chat_message_${chatId}_${message.id}_${reportedBy}`
        const ok = window.confirm(t.chatReport.confirm)
        if (!ok) return

        try {
            setReportingMessageId(message.id)

            const reportRef = doc(db, "reports", reportId)
            const existing = await getDoc(reportRef)
            if (existing.exists()) {
                alert(t.chatReport.duplicate)
                return
            }

            await setDoc(reportRef, {
                type: "chat_message",
                chatId,
                messageId: message.id,
                senderId: message.senderId,
                senderName,
                reportedBy,
                reportedByName: currentUser.nickname,
                messageText: message.text,
                createdAt: Date.now(),
                status: "pending",
            })

            alert(t.chatReport.sent)
        } catch (error) {
            console.error("[chat] report message failed", error)
            alert(t.chatReport.error)
        } finally {
            setReportingMessageId("")
        }
    }

    // ===== UI =====
    return (
        <div className="stack12">
            <button
                onClick={() => navigate(-1)}
                style={{
                    background: "none",
                    border: "none",
                    color: "#1976d2",
                    cursor: "pointer",
                    padding: 0,
                }}
            >
                ← Назад
            </button>

            {otherUserId && (
                <div style={{ fontSize: 14 }}>
                    Чат з{" "}
                    <span
                        onClick={() => navigate(`/user/${otherUserId}`)}
                        style={{ color: "#1976d2", fontWeight: 700, cursor: "pointer" }}
                    >
                        {otherNickname}
                    </span>
                </div>
            )}

            <div
                className="card"
                style={{
                    border: "1px solid #fbbf24",
                    background: "#fffbeb",
                    color: "#78350f",
                    fontSize: 13,
                }}
            >
                ⚠️ {t.common.chatSafetyNotice}
            </div>

            <div
                className="card"
                style={{
                    display: "flex",
                    flexDirection: "column",
                    height: "70vh",
                }}
            >
                <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
                    {loading && <div>Завантаження…</div>}

                    {!loading && messages.length === 0 && (
                        <div style={{ fontSize: 14, color: "#6b7280" }}>
                            Повідомлень ще немає
                        </div>
                    )}

                    {messages.map(m => {
                        const isMine = currentIds.includes(m.senderId)
                        const isSystem = m.senderType === "system"
                        const senderName = isSystem
                            ? (m.senderName || "Xoven Admin")
                            : isMine
                                ? currentUser.nickname
                                : (m.senderName || senderNamesById[m.senderId] || t.common.user)

                        return (
                            <div
                                key={m.id}
                                style={{
                                    display: "flex",
                                    justifyContent: isSystem ? "center" : isMine ? "flex-end" : "flex-start",
                                    marginBottom: 6,
                                }}
                            >
                                <div
                                    style={{
                                        padding: "8px 12px",
                                        borderRadius: 12,
                                        maxWidth: "70%",
                                        background: isSystem ? "#fef3c7" : isMine ? "#1976d2" : "#e5e7eb",
                                        color: isSystem ? "#78350f" : isMine ? "#fff" : "#111827",
                                        fontSize: 14,
                                    }}
                                >
                                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                                        {senderName}
                                    </div>
                                    {m.text}
                                    {!isMine && !isSystem && (
                                        <div style={{ marginTop: 6 }}>
                                            <button
                                                type="button"
                                                onClick={() => void reportMessage(m, senderName)}
                                                disabled={reportingMessageId === m.id}
                                                style={{
                                                    border: "none",
                                                    background: "transparent",
                                                    color: "#b91c1c",
                                                    padding: 0,
                                                    fontSize: 12,
                                                    cursor: reportingMessageId === m.id ? "wait" : "pointer",
                                                    fontWeight: 700,
                                                }}
                                            >
                                                {t.chatReport.report}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>

                <form
                    onSubmit={async e => {
                        e.preventDefault()
                        if (!text.trim()) return

                        const now = Date.now()
                        if (now - lastSentAt < 1000) {
                            return
                        }

                        try {
                            setSending(true)
                            setSendError("")

                            await sendMessage(
                                chatId,
                                currentUser.id,
                                otherUserId,
                                text,
                                currentUser.nickname
                            )

                            setText("")
                            setLastSentAt(now)
                        } catch (e) {
                            console.error("[chat] send failed", e)
                            setSendError(isAccountRestrictedError(e)
                                ? t.common.accountRestricted
                                : "Не вдалося надіслати повідомлення. Спробуйте ще раз.")
                        } finally {
                            setSending(false)
                        }
                    }}


                    style={{ display: "flex", gap: 8 }}
                >
                    <input
                        className="input"
                        placeholder="Напишіть повідомлення…"
                        value={text}
                        onChange={e => setText(e.target.value)}
                        disabled={sending}
                    />
                    {sendError && (
                        <div style={{ color: "#b91c1c", fontSize: 13 }}>{sendError}</div>
                    )}
                    <button
                        className="btn-primary"
                        disabled={sending || !text.trim()}

                    >
                        Надіслати
                    </button>
                </form>
            </div>
        </div>
    )
}

export default ChatPage
