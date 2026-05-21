
import { useParams, useNavigate } from "react-router-dom"
import { getLocalUser } from "../data/localUser"
import {
    sendMessage,
    subscribeToChatMessages,
    markChatAsRead,
    getChatUsers,
} from "../data/chats"
import { getUserPublicNickname } from "../data/usersPublic"
import { useEffect, useState } from "react"

type ChatMessage = {
    id: string
    senderId: string
    text: string
    createdAt?: unknown
}

function ChatPage() {
    const { id: chatId } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const currentUser = getLocalUser()

    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [text, setText] = useState("")
    const [loading, setLoading] = useState(true)
    const [sending, setSending] = useState(false)

    const [otherUserId, setOtherUserId] = useState<string>("")
    const [otherNickname, setOtherNickname] = useState<string>("")
    const [lastSentAt, setLastSentAt] = useState<number>(0)
    const [sendError, setSendError] = useState<string>("")


    const currentIds = currentUser
        ? [currentUser.id, currentUser.uid, currentUser.email]
        : []

    function isCurrentUserId(value: string) {
        return currentIds.includes(value)
    }


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
        markChatAsRead(chatId, currentUser.id)
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

                const nick = await getUserPublicNickname(otherId)
                setOtherNickname(nick || "Користувач")
            } catch (e) {
                console.error("[chat] failed to resolve other user", e)
            }
        })()
    }, [chatId, currentIds.join("|")])

    // ===== guards =====
    if (!currentUser) {
        return <div className="card">Увійдіть, щоб користуватися чатом</div>
    }

    if (typeof chatId !== "string") {
        return <div className="card">Чат не знайдено</div>
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

                        return (
                            <div
                                key={m.id}
                                style={{
                                    display: "flex",
                                    justifyContent: isMine ? "flex-end" : "flex-start",
                                    marginBottom: 6,
                                }}
                            >
                                <div
                                    style={{
                                        padding: "8px 12px",
                                        borderRadius: 12,
                                        maxWidth: "70%",
                                        background: isMine ? "#1976d2" : "#e5e7eb",
                                        color: isMine ? "#fff" : "#111827",
                                        fontSize: 14,
                                    }}
                                >
                                    {m.text}
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
                                text
                            )

                            setText("")
                            setLastSentAt(now)
                        } catch (e) {
                            console.error("[chat] send failed", e)
                            setSendError("Не вдалося надіслати повідомлення. Спробуйте ще раз.")
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
