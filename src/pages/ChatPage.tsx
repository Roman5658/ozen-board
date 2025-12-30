
import { useParams, useNavigate } from "react-router-dom"
import { getLocalUser } from "../data/localUser"
import {
    sendMessage,
    subscribeToChatMessages,
    markChatAsRead,
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
        if (!currentUser) return
        if (messages.length === 0) return

        const otherId = messages
            .map(m => m.senderId)
            .find(id => id !== currentUser.id)

        if (!otherId) return

        setOtherUserId(otherId)

        getUserPublicNickname(otherId).then(nick => {
            setOtherNickname(nick || "Користувач")
        })
    }, [messages, currentUser])

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
                        const isMine = m.senderId === currentUser.id

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

                            await sendMessage(
                                chatId,
                                currentUser.id,
                                otherUserId,
                                text
                            )

                            setText("")
                            setLastSentAt(now)
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
