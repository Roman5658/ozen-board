import { useEffect, useState } from "react"
import { doc, getDoc } from "firebase/firestore"
import { Link } from "react-router-dom"
import { db } from "../app/firebase"
import { useNavigate } from "react-router-dom"
import { getLocalUser } from "../data/localUser"
import { getOrCreateChat } from "../data/chats"

type Props = {
    userId: string
    hideActions?: boolean // пригодится позже (например, в чате)
    isOwner?: boolean
    onReport?: () => void
}

type PublicUser = {
    nickname: string
    karma: number
    phone?: string | null
    telegram?: string | null
}

function AuthorCard({ userId, hideActions }: Props) {
    const [user, setUser] = useState<PublicUser | null>(null)
    const [loading, setLoading] = useState(true)
    const navigate = useNavigate()
    const currentUser = getLocalUser()
    const isMe = currentUser?.id === userId

    useEffect(() => {
        async function loadUser() {
            try {
                const ref = doc(db, "users", userId)
                const snap = await getDoc(ref)

                if (snap.exists()) {
                    const data = snap.data()
                    setUser({
                        nickname: data.nickname ?? "Користувач",
                        karma: typeof data.karma === "number" ? data.karma : 0,
                        phone: typeof data.phone === "string" ? data.phone : null,
                        telegram: typeof data.telegram === "string" ? data.telegram : null,
                    })
                } else {
                    setUser(null)
                }
            } finally {
                setLoading(false)
            }
        }

        loadUser()
    }, [userId])

    if (loading) {
        return (
            <div style={{ fontSize: 13, color: "#6b7280" }}>
                Завантаження продавця…
            </div>
        )
    }

    if (!user) {
        return (
            <div style={{ fontSize: 13, color: "#6b7280" }}>
                Користувача не знайдено
            </div>
        )
    }

    return (
        <div
            style={{
                padding: 12,
                borderRadius: 12,
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
            }}
        >
            <div>
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                    Продавець
                </div>

                <Link
                    to={`/user/${userId}`}
                    style={{
                        fontWeight: 700,
                        color: "#1976d2",
                        textDecoration: "none",
                        display: "inline-block",
                        marginTop: 2,
                    }}
                >
                    {user.nickname}
                </Link>

                <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
                    Карма: {user.karma}
                </div>

                {(user.phone || user.telegram) && (
                    <div style={{ fontSize: 13, marginTop: 6 }}>
                        {user.phone && (
                            <div>📞 {user.phone}</div>
                        )}
                        {user.telegram && (
                            <div>
                                ✈️{" "}
                                <a
                                    href={`https://t.me/${user.telegram.replace("@", "")}`}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    @{user.telegram.replace("@", "")}
                                </a>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {!hideActions && !isMe && currentUser && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                        className="btn-primary"
                        onClick={async () => {
                            try {
                                const chatId = await getOrCreateChat(
                                    currentUser.id,
                                    userId
                                )

                                navigate(`/chat/${chatId}`)


                            } catch (e) {
                                console.error(e)
                                alert("Не вдалося створити чат")
                            }
                        }}
                    >
                        Написати
                    </button>

                    <Link
                        to={`/user/${userId}`}
                        className="btn-secondary"
                    >
                        Профіль
                    </Link>
                </div>
            )}

        </div>
    )
}

export default AuthorCard
