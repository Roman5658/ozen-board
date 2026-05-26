import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { arrayUnion, doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { db } from "../app/firebase"
import type { translations } from "../app/i18n"
import { getUnreadCountForUser, getUserChats } from "../data/chats"
import type { ChatItem } from "../data/chats"
import { getLocalUser } from "../data/localUser"
import { getUserPublicNicknames } from "../data/usersPublic"
import type { AppUser } from "../types/user"

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

function AccountChatsPage({ t }: Props) {
    const a = t.account
    const navigate = useNavigate()
    const [user, setUser] = useState<AppUser | null>(null)
    const [chats, setChats] = useState<ChatItem[]>([])
    const [nickCache, setNickCache] = useState<Record<string, string>>({})
    const [loadingChats, setLoadingChats] = useState(true)

    useEffect(() => {
        const currentUser = getLocalUser()

        if (!currentUser) {
            navigate("/account")
            return
        }

        setUser(currentUser)
    }, [navigate])

    useEffect(() => {
        if (!user) return

        let isActive = true
        setLoadingChats(true)

        getUserChats(user.id, user.uid)
            .then((items) => {
                if (isActive) setChats(items)
            })
            .finally(() => {
                if (isActive) setLoadingChats(false)
            })

        return () => {
            isActive = false
        }
    }, [user])

    useEffect(() => {
        if (!user || chats.length === 0) return

        const otherIds = Array.from(
            new Set(
                chats
                    .map(c => c.users.find(id => id !== user.id))
                    .filter((x): x is string => !!x)
            )
        )

        const missing = otherIds.filter(id => !nickCache[id])
        if (missing.length === 0) return

        let isActive = true

        getUserPublicNicknames(missing, a.chats.userFallback)
            .then(names => {
                if (!isActive) return

                setNickCache(prev => ({
                    ...prev,
                    ...names,
                }))
            })
            .catch(error => console.warn("[account chats] failed to load nicknames", error))

        return () => {
            isActive = false
        }
    }, [a.chats.userFallback, chats, nickCache, user])

    async function handleDeleteChat(chatId: string) {
        if (!user) return

        const ok = window.confirm(a.confirms.deleteChat)
        if (!ok) return

        try {
            await updateDoc(doc(db, "chats", chatId), {
                hiddenFor: arrayUnion(user.id),
                [`hiddenForAt.${user.id}`]: serverTimestamp(),
            })

            setChats(prev => prev.filter(c => c.id !== chatId))
        } catch (e) {
            console.error(e)
            alert(a.alerts.deleteChatError)
        }
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
                            ? (nickCache[otherUserId] || "...")
                            : a.chats.userFallback,
                    lastMessage: chat.lastMessage || a.chats.noMessages,
                    updatedAt: chat.updatedAt,
                    isUnread,
                    isNewChat,
                    unreadCount,
                }
            })
            .filter(row => !!row.otherUserId)
            .sort((left, right) => {
                if (left.isUnread && !right.isUnread) return -1
                if (!left.isUnread && right.isUnread) return 1
                return (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
            })
        : []

    return (
        <div className="stack12">
            <div className="card stack12">
                <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap"}}>
                    <h2 className="h2">{a.chats.title}</h2>
                    <Link
                        to="/account"
                        className="btn-secondary"
                        style={{display: "inline-block", textAlign: "center"}}
                    >
                        {a.payments.back}
                    </Link>
                </div>

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
                            maxHeight: 560,
                            overflowY: "auto",
                            paddingRight: 4,
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
        </div>
    )
}

export default AccountChatsPage
