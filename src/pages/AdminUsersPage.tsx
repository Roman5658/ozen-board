import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore"
import { db } from "../app/firebase"
import { getLocalUser } from "../data/localUser"
import { buildAdPath, buildAuctionPath } from "../utils/slug"
import AdminPagination, { getAdminPaginationLabels, paginateItems } from "../components/AdminPagination"

import type { translations } from "../app/i18n"
import type { Ad } from "../types/ad"
import type { Auction } from "../types/auction"
import type { Report } from "../types/report"

type AppTranslations = (typeof translations)[keyof typeof translations]

type Props = {
    t: AppTranslations
}

const HISTORY_PAGE_SIZE = 10

type AdminUser = {
    id: string
    uid?: string
    email?: string
    nickname?: string
    createdAt?: number | null
    updatedAt?: number | null
    status?: string
    blockedAt?: number | null
    blockedReason?: string
    blockedBy?: string
    unblockedAt?: number | null
    unblockReason?: string
    unblockedBy?: string
}

type ChatSummary = {
    id: string
    users: string[]
    updatedAt?: number | null
    lastMessage?: string
}

type UserHistory = {
    ads: Ad[]
    auctions: Auction[]
    reportsCreated: Report[]
    reportsAboutUser: Report[]
    chats: ChatSummary[]
}

function toMillis(value: unknown): number | null {
    if (typeof value === "number") return value
    if (value && typeof value === "object" && "toMillis" in value) {
        const timestamp = value as { toMillis?: () => number }
        return timestamp.toMillis?.() ?? null
    }

    return null
}

function getString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined
}

function uniqueValues(values: Array<string | undefined | null>): string[] {
    return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function sortByCreatedAt<T extends { createdAt?: number }>(items: T[]): T[] {
    return [...items].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

function statusCounts<T extends { status?: string }>(items: T[]): Record<string, number> {
    return items.reduce<Record<string, number>>((acc, item) => {
        const status = item.status || "unknown"
        acc[status] = (acc[status] ?? 0) + 1
        return acc
    }, {})
}

function formatDate(value: number | null | undefined, locale: string): string {
    if (!value) return "-"
    return new Date(value).toLocaleString(locale)
}

function reportFromDoc(id: string, data: Record<string, unknown>): Report {
    const isChatMessageReport = data.type === "chat_message"
    const targetType = isChatMessageReport
        ? "chat_message"
        : data.targetType === "auction"
            ? "auction"
            : "ad"

    return {
        id,
        targetType,
        targetId: isChatMessageReport
            ? (getString(data.messageId) ?? "")
            : (getString(data.targetId) ?? getString(data.adId) ?? ""),
        reporterId: getString(data.reporterId) ?? getString(data.reporterUserId) ?? getString(data.reportedBy) ?? "",
        reason: getString(data.reason) ?? "user-report",
        description: getString(data.description) ?? getString(data.message) ?? getString(data.messageText) ?? "",
        createdAt: toMillis(data.createdAt) ?? Date.now(),
        status: (getString(data.status) ?? (isChatMessageReport ? "pending" : "new")) as Report["status"],
        reviewedAt: toMillis(data.reviewedAt),
        reviewedBy: getString(data.reviewedBy) ?? null,
        resolutionNote: getString(data.resolutionNote) ?? null,
        notificationNeeded: typeof data.notificationNeeded === "boolean" ? data.notificationNeeded : null,
        ownerNotified: typeof data.ownerNotified === "boolean" ? data.ownerNotified : null,
        reporterNotified: typeof data.reporterNotified === "boolean" ? data.reporterNotified : null,
        type: isChatMessageReport ? "chat_message" : undefined,
        chatId: getString(data.chatId),
        messageId: getString(data.messageId),
        senderId: getString(data.senderId),
        senderName: getString(data.senderName) ?? null,
        reportedBy: getString(data.reportedBy),
        reportedByName: getString(data.reportedByName) ?? null,
        messageText: getString(data.messageText),
    }
}

async function loadDocsByUserField<T>(
    collectionName: string,
    fieldName: string,
    userIds: string[]
): Promise<T[]> {
    const byId = new Map<string, T>()

    await Promise.all(userIds.map(async (userId) => {
        const snap = await getDocs(query(collection(db, collectionName), where(fieldName, "==", userId)))
        snap.docs.forEach((docSnap) => {
            byId.set(docSnap.id, { id: docSnap.id, ...docSnap.data() } as T)
        })
    }))

    return Array.from(byId.values())
}

async function loadChatsForUser(userIds: string[]): Promise<ChatSummary[]> {
    const byId = new Map<string, ChatSummary>()

    await Promise.all(userIds.map(async (userId) => {
        const snap = await getDocs(query(collection(db, "chats"), where("users", "array-contains", userId)))
        snap.docs.forEach((docSnap) => {
            const data = docSnap.data()
            byId.set(docSnap.id, {
                id: docSnap.id,
                users: Array.isArray(data.users) ? data.users.filter((item): item is string => typeof item === "string") : [],
                updatedAt: toMillis(data.updatedAt),
                lastMessage: getString(data.lastMessage),
            })
        })
    }))

    return Array.from(byId.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

function countLine(counts: Record<string, number>, statuses: string[]): string {
    return statuses.map((status) => `${status}: ${counts[status] ?? 0}`).join(" · ")
}

export default function AdminUsersPage({ t }: Props) {
    const text = t.adminUsers
    const locale = t.adminReports.locale
    const paginationLabels = getAdminPaginationLabels(locale === "pl-PL" ? "pl" : "uk")
    const [users, setUsers] = useState<AdminUser[]>([])
    const [selectedUserId, setSelectedUserId] = useState("")
    const [search, setSearch] = useState("")
    const [adsPage, setAdsPage] = useState(1)
    const [auctionsPage, setAuctionsPage] = useState(1)
    const [reportsPage, setReportsPage] = useState(1)
    const [chatsPage, setChatsPage] = useState(1)
    const [history, setHistory] = useState<UserHistory | null>(null)
    const [loading, setLoading] = useState(true)
    const [historyLoading, setHistoryLoading] = useState(false)
    const [moderationLoading, setModerationLoading] = useState(false)
    const [error, setError] = useState("")

    useEffect(() => {
        let cancelled = false

        ;(async () => {
            setLoading(true)
            try {
                const snap = await getDocs(collection(db, "users"))
                const loadedUsers = snap.docs.map((docSnap) => {
                    const data = docSnap.data()
                    return {
                        id: docSnap.id,
                        uid: getString(data.uid),
                        email: getString(data.email),
                        nickname: getString(data.nickname),
                        createdAt: toMillis(data.createdAt),
                        updatedAt: toMillis(data.updatedAt),
                        status: getString(data.status) ?? "active",
                        blockedAt: toMillis(data.blockedAt),
                        blockedReason: getString(data.blockedReason),
                        blockedBy: getString(data.blockedBy),
                        unblockedAt: toMillis(data.unblockedAt),
                        unblockReason: getString(data.unblockReason),
                        unblockedBy: getString(data.unblockedBy),
                    }
                }).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

                if (!cancelled) {
                    setUsers(loadedUsers)
                }
            } catch {
                if (!cancelled) setError(text.loadError)
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [text.loadError])

    const selectedUser = useMemo(
        () => users.find((user) => user.id === selectedUserId) ?? null,
        [selectedUserId, users]
    )

    const matchingUsers = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (q.length < 2) return []

        return users.filter((user) => {
            const haystack = [
                user.id,
                user.uid,
                user.email,
                user.nickname,
            ].filter(Boolean).join(" ").toLowerCase()

            return haystack.includes(q)
        })
    }, [search, users])

    const searchResults = useMemo(
        () => matchingUsers.slice(0, 20),
        [matchingUsers]
    )

    useEffect(() => {
        if (!selectedUser) {
            setHistory(null)
            return
        }

        let cancelled = false

        ;(async () => {
            setHistoryLoading(true)
            setError("")
            try {
                const userIds = uniqueValues([selectedUser.id, selectedUser.uid, selectedUser.email])

                const [ads, auctions, reportsSnap, chats] = await Promise.all([
                    loadDocsByUserField<Ad>("ads", "userId", userIds),
                    loadDocsByUserField<Auction>("auctions", "ownerId", userIds),
                    getDocs(collection(db, "reports")),
                    loadChatsForUser(userIds),
                ])

                const adIds = new Set(ads.map((ad) => ad.id))
                const auctionIds = new Set(auctions.map((auction) => auction.id))
                const reports = reportsSnap.docs.map((docSnap) => reportFromDoc(docSnap.id, docSnap.data()))
                const userIdSet = new Set(userIds)

                const reportsCreated = reports.filter((report) => {
                    return userIdSet.has(report.reporterId) || (report.reportedBy ? userIdSet.has(report.reportedBy) : false)
                })

                const reportsAboutUser = reports.filter((report) => {
                    if (report.targetType === "ad") return adIds.has(report.targetId)
                    if (report.targetType === "auction") return auctionIds.has(report.targetId)
                    if (report.targetType === "chat_message") return Boolean(report.senderId && userIdSet.has(report.senderId))
                    return false
                })

                if (!cancelled) {
                    setHistory({
                        ads: sortByCreatedAt(ads),
                        auctions: sortByCreatedAt(auctions),
                        reportsCreated: sortByCreatedAt(reportsCreated),
                        reportsAboutUser: sortByCreatedAt(reportsAboutUser),
                        chats,
                    })
                }
            } catch {
                if (!cancelled) {
                    setError(text.loadError)
                    setHistory(null)
                }
            } finally {
                if (!cancelled) setHistoryLoading(false)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [selectedUser, text.loadError])

    const adCounts = useMemo(() => statusCounts(history?.ads ?? []), [history?.ads])
    const auctionCounts = useMemo(() => statusCounts(history?.auctions ?? []), [history?.auctions])
    const combinedReports = useMemo(() => {
        const byId = new Map<string, Report>()
        ;[...(history?.reportsAboutUser ?? []), ...(history?.reportsCreated ?? [])].forEach(report => {
            byId.set(report.id, report)
        })
        return sortByCreatedAt(Array.from(byId.values()))
    }, [history?.reportsAboutUser, history?.reportsCreated])

    const pagedHistoryAds = useMemo(
        () => paginateItems(history?.ads ?? [], adsPage, HISTORY_PAGE_SIZE),
        [adsPage, history?.ads]
    )

    const pagedHistoryAuctions = useMemo(
        () => paginateItems(history?.auctions ?? [], auctionsPage, HISTORY_PAGE_SIZE),
        [auctionsPage, history?.auctions]
    )

    const pagedHistoryReports = useMemo(
        () => paginateItems(combinedReports, reportsPage, HISTORY_PAGE_SIZE),
        [combinedReports, reportsPage]
    )

    const pagedHistoryChats = useMemo(
        () => paginateItems(history?.chats ?? [], chatsPage, HISTORY_PAGE_SIZE),
        [chatsPage, history?.chats]
    )

    useEffect(() => {
        setAdsPage(1)
        setAuctionsPage(1)
        setReportsPage(1)
        setChatsPage(1)
    }, [selectedUserId])

    async function blockUser() {
        if (!selectedUser || selectedUser.status === "blocked") return

        const reason = window.prompt(text.blockReasonPrompt)?.trim()
        if (!reason) {
            alert(text.blockReasonRequired)
            return
        }

        const admin = getLocalUser()
        const adminId = admin?.uid || admin?.id || admin?.email || "admin"
        const patch = {
            status: "blocked",
            blockedAt: Date.now(),
            blockedReason: reason,
            blockedBy: adminId,
            updatedAt: Date.now(),
        }

        setModerationLoading(true)
        try {
            await updateDoc(doc(db, "users", selectedUser.id), patch)
            setUsers((current) => current.map((user) => (
                user.id === selectedUser.id ? { ...user, ...patch } : user
            )))
            alert(text.blockedAlert)
        } catch {
            setError(text.loadError)
        } finally {
            setModerationLoading(false)
        }
    }

    async function unblockUser() {
        if (!selectedUser || selectedUser.status !== "blocked") return

        const reason = window.prompt(text.unblockReasonPrompt)?.trim()
        if (!reason) {
            alert(text.unblockReasonRequired)
            return
        }

        const admin = getLocalUser()
        const adminId = admin?.uid || admin?.id || admin?.email || "admin"
        const patch = {
            status: "active",
            unblockedAt: Date.now(),
            unblockReason: reason,
            unblockedBy: adminId,
            unblockEmailSent: false,
            updatedAt: Date.now(),
        }

        setModerationLoading(true)
        try {
            await updateDoc(doc(db, "users", selectedUser.id), patch)
            setUsers((current) => current.map((user) => (
                user.id === selectedUser.id ? { ...user, ...patch } : user
            )))
            alert(text.unblockedAlert)
        } catch {
            setError(text.loadError)
        } finally {
            setModerationLoading(false)
        }
    }

    return (
        <div style={{ display: "grid", gap: 18 }}>
            <header>
                <h1 style={{ margin: "0 0 6px" }}>{text.title}</h1>
                <p style={{ margin: 0, color: "#64748b" }}>{text.subtitle}</p>
            </header>

            {error && (
                <div style={{ padding: 12, borderRadius: 8, background: "#fee2e2", color: "#991b1b" }}>
                    {error}
                </div>
            )}

            <section style={{ padding: 14, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
                <label style={{ display: "grid", gap: 6, maxWidth: 520 }}>
                    <span style={{ fontWeight: 700 }}>{text.selectUser}</span>
                    <input
                        className="input"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        disabled={loading || users.length === 0}
                        placeholder={text.searchPlaceholder}
                        style={{ minHeight: 42, borderRadius: 8, border: "1px solid #cbd5e1", padding: "0 10px" }}
                    />
                </label>
                {search.trim().length > 0 && search.trim().length < 2 && (
                    <p style={{ color: "#64748b" }}>{text.minSearchHint}</p>
                )}
                {search.trim().length >= 2 && (
                    <p style={{ color: "#64748b" }}>{paginationLabels.count(matchingUsers.length)}</p>
                )}
                {searchResults.length > 0 && (
                    <div style={{ display: "grid", gap: 6, marginTop: 10, maxWidth: 620 }}>
                        {searchResults.map((user) => (
                            <button
                                key={user.id}
                                type="button"
                                onClick={() => {
                                    setSelectedUserId(user.id)
                                    setSearch(user.nickname || user.email || user.id)
                                }}
                                style={{
                                    textAlign: "left",
                                    padding: 10,
                                    border: user.id === selectedUserId ? "1px solid #2563eb" : "1px solid #e5e7eb",
                                    borderRadius: 8,
                                    background: user.id === selectedUserId ? "#eff6ff" : "#fff",
                                    cursor: "pointer",
                                }}
                            >
                                <div style={{ fontWeight: 700 }}>
                                    {user.nickname || text.noItems}
                                    {user.status === "blocked" && (
                                        <span style={{ marginLeft: 8, color: "#b91c1c" }}>{text.blockedBadge}</span>
                                    )}
                                </div>
                                <div style={{ fontSize: 13, color: "#64748b" }}>{user.email || user.id}</div>
                            </button>
                        ))}
                    </div>
                )}
                {loading && <p>{text.loading}</p>}
                {!loading && users.length === 0 && <p>{text.empty}</p>}
            </section>

            {selectedUser && (
                <section style={{ padding: 14, border: "1px solid #e5e7eb", borderRadius: 8, background: "#f8fafc" }}>
                    <h2 style={{ marginTop: 0 }}>{text.basicInfo}</h2>
                    <div style={{ display: "grid", gap: 6 }}>
                        <div><b>{text.userId}:</b> {selectedUser.id}</div>
                        <div><b>{text.uid}:</b> {selectedUser.uid ?? "-"}</div>
                        <div><b>{text.email}:</b> {selectedUser.email ?? "-"}</div>
                        <div><b>{text.nickname}:</b> {selectedUser.nickname ?? "-"}</div>
                        <div><b>{text.createdAt}:</b> {formatDate(selectedUser.createdAt, locale)}</div>
                        <div><b>{text.updatedAt}:</b> {formatDate(selectedUser.updatedAt, locale)}</div>
                        <div>
                            <b>{text.status}:</b>{" "}
                            <span style={{
                                color: selectedUser.status === "blocked" ? "#b91c1c" : "#15803d",
                                fontWeight: 700,
                            }}>
                                {selectedUser.status === "blocked" ? text.statusBlocked : text.statusActive}
                            </span>
                        </div>
                        {selectedUser.status === "blocked" && (
                            <>
                                <div><b>{text.blockedAt}:</b> {formatDate(selectedUser.blockedAt, locale)}</div>
                                <div><b>{text.blockedReason}:</b> {selectedUser.blockedReason ?? "-"}</div>
                                <div><b>{text.blockedBy}:</b> {selectedUser.blockedBy ?? "-"}</div>
                            </>
                        )}
                        {selectedUser.unblockedAt && (
                            <>
                                <div><b>{text.unblockedAt}:</b> {formatDate(selectedUser.unblockedAt, locale)}</div>
                                <div><b>{text.unblockReason}:</b> {selectedUser.unblockReason ?? "-"}</div>
                                <div><b>{text.unblockedBy}:</b> {selectedUser.unblockedBy ?? "-"}</div>
                            </>
                        )}
                    </div>
                    {selectedUser.status === "blocked" ? (
                        <button
                            type="button"
                            onClick={unblockUser}
                            disabled={moderationLoading}
                            style={{
                                marginTop: 12,
                                padding: "9px 12px",
                                borderRadius: 8,
                                border: "1px solid #16a34a",
                                color: "#166534",
                                background: "#dcfce7",
                                cursor: "pointer",
                                fontWeight: 700,
                            }}
                        >
                            {text.unblockUser}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={blockUser}
                            disabled={moderationLoading}
                            style={{
                                marginTop: 12,
                                padding: "9px 12px",
                                borderRadius: 8,
                                border: "1px solid #dc2626",
                                color: "#991b1b",
                                background: "#fee2e2",
                                cursor: "pointer",
                                fontWeight: 700,
                            }}
                        >
                            {text.blockUser}
                        </button>
                    )}
                </section>
            )}

            {historyLoading && <p>{text.loading}</p>}

            {history && (
                <>
                    <section style={{ padding: 14, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
                        <h2 style={{ marginTop: 0 }}>{text.adsTitle}</h2>
                        <p style={{ color: "#475569" }}>{countLine(adCounts, ["active", "hidden", "deleted", "removed", "expired"])}</p>
                        <div style={{ display: "grid", gap: 8 }}>
                            {history.ads.length > 0 && (
                                <AdminPagination
                                    page={adsPage}
                                    pageSize={HISTORY_PAGE_SIZE}
                                    totalItems={history.ads.length}
                                    labels={paginationLabels}
                                    onPageChange={setAdsPage}
                                />
                            )}
                            {pagedHistoryAds.map((ad) => (
                                <div key={ad.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
                                    <div>
                                        <b>{ad.title}</b>
                                        <div style={{ color: "#64748b", fontSize: 13 }}>
                                            {ad.status ?? "active"} · {formatDate(ad.createdAt, locale)}
                                        </div>
                                    </div>
                                    <Link to={buildAdPath(ad.title, ad.city, ad.id)}>{text.open}</Link>
                                </div>
                            ))}
                            {history.ads.length === 0 && <p>{text.noItems}</p>}
                        </div>
                    </section>

                    <section style={{ padding: 14, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
                        <h2 style={{ marginTop: 0 }}>{text.auctionsTitle}</h2>
                        <p style={{ color: "#475569" }}>{countLine(auctionCounts, ["active", "ended", "deleted", "removed", "expired"])}</p>
                        <div style={{ display: "grid", gap: 8 }}>
                            {history.auctions.length > 0 && (
                                <AdminPagination
                                    page={auctionsPage}
                                    pageSize={HISTORY_PAGE_SIZE}
                                    totalItems={history.auctions.length}
                                    labels={paginationLabels}
                                    onPageChange={setAuctionsPage}
                                />
                            )}
                            {pagedHistoryAuctions.map((auction) => (
                                <div key={auction.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
                                    <div>
                                        <b>{auction.title}</b>
                                        <div style={{ color: "#64748b", fontSize: 13 }}>
                                            {auction.status} · {text.currentBid}: {auction.currentBid ?? 0} zł · {formatDate(auction.createdAt, locale)}
                                        </div>
                                    </div>
                                    <Link to={buildAuctionPath(auction.title, auction.city, auction.id)}>{text.open}</Link>
                                </div>
                            ))}
                            {history.auctions.length === 0 && <p>{text.noItems}</p>}
                        </div>
                    </section>

                    <section style={{ padding: 14, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
                        <h2 style={{ marginTop: 0 }}>{text.reportsTitle}</h2>
                        <p style={{ color: "#475569" }}>
                            {text.reportsCreated}: {history.reportsCreated.length} · {text.reportsAboutUser}: {history.reportsAboutUser.length}
                        </p>
                        <div style={{ display: "grid", gap: 8 }}>
                            {combinedReports.length > 0 && (
                                <AdminPagination
                                    page={reportsPage}
                                    pageSize={HISTORY_PAGE_SIZE}
                                    totalItems={combinedReports.length}
                                    labels={paginationLabels}
                                    onPageChange={setReportsPage}
                                />
                            )}
                            {pagedHistoryReports.map((report) => (
                                <div key={report.id} style={{ borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
                                    <b>{report.targetType}</b> · {report.status} · {formatDate(report.createdAt, locale)}
                                    <div style={{ color: "#64748b", fontSize: 13 }}>
                                        {report.description || report.reason || report.id}
                                    </div>
                                </div>
                            ))}
                            {combinedReports.length === 0 && <p>{text.noItems}</p>}
                        </div>
                    </section>

                    <section style={{ padding: 14, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
                        <h2 style={{ marginTop: 0 }}>{text.chatsTitle}</h2>
                        <p style={{ color: "#475569" }}>{text.chatCount}: {history.chats.length}</p>
                        <div style={{ display: "grid", gap: 8 }}>
                            {history.chats.length > 0 && (
                                <AdminPagination
                                    page={chatsPage}
                                    pageSize={HISTORY_PAGE_SIZE}
                                    totalItems={history.chats.length}
                                    labels={paginationLabels}
                                    onPageChange={setChatsPage}
                                />
                            )}
                            {pagedHistoryChats.map((chat) => (
                                <div key={chat.id} style={{ borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
                                    <b>{chat.id}</b>
                                    <div style={{ color: "#64748b", fontSize: 13 }}>
                                        {text.participants}: {chat.users.join(", ") || "-"}
                                    </div>
                                    <div style={{ color: "#64748b", fontSize: 13 }}>
                                        {text.updatedAt}: {formatDate(chat.updatedAt, locale)}
                                    </div>
                                </div>
                            ))}
                            {history.chats.length === 0 && <p>{text.noItems}</p>}
                        </div>
                    </section>
                </>
            )}
        </div>
    )
}
