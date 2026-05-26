import { useEffect, useMemo, useState } from "react"
import {
    collection,
    doc,
    getCountFromServer,
    getDoc,
    getDocs,
    query,
    where,
    type DocumentData,
} from "firebase/firestore"

import { db } from "../app/firebase"
import { getLocalUser } from "../data/localUser"

type ExportKey = "users" | "ads" | "auctions" | "chats" | "reports" | "payments" | "userHistory"

type ExportConfig = {
    key: Exclude<ExportKey, "userHistory">
    collectionName: string
    title: string
    description: string
}

type ExportStatus = {
    type: "success" | "error"
    message: string
}

function getLang() {
    return localStorage.getItem("lang") === "pl" ? "pl" : "uk"
}

function toMillis(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (value && typeof value === "object" && "toMillis" in value) {
        const timestamp = value as { toMillis?: () => number }
        return timestamp.toMillis?.() ?? null
    }

    return null
}

function normalizeFirestoreValue(value: unknown): unknown {
    if (value && typeof value === "object" && "toMillis" in value && "toDate" in value) {
        const timestamp = value as { toMillis?: () => number; toDate?: () => Date }
        const millis = timestamp.toMillis?.() ?? null
        return {
            type: "timestamp",
            millis,
            iso: timestamp.toDate?.().toISOString() ?? (millis ? new Date(millis).toISOString() : null),
        }
    }

    if (Array.isArray(value)) return value.map(normalizeFirestoreValue)

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, child]) => [
                key,
                normalizeFirestoreValue(child),
            ])
        )
    }

    return value
}

function getLatestSortValue(item: Record<string, unknown>) {
    return toMillis(item.createdAt) ??
        toMillis(item.updatedAt) ??
        toMillis(item.capturedAt) ??
        toMillis(item.lastMessageAt) ??
        toMillis(item.processedAt) ??
        0
}

function sortLatestFirst<T extends Record<string, unknown>>(items: T[]) {
    return [...items].sort((a, b) => getLatestSortValue(b) - getLatestSortValue(a))
}

function downloadJson(fileName: string, payload: unknown) {
    const json = JSON.stringify(payload, null, 2)
    const blob = new Blob([json], { type: "application/json;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
}

function safeFilePart(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "export"
}

function unique(values: Array<string | null | undefined>) {
    return Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))))
}

function docToExport(docId: string, data: DocumentData) {
    return normalizeFirestoreValue({
        id: docId,
        ...data,
    }) as Record<string, unknown>
}

async function loadCollectionDocs(collectionName: string) {
    const snap = await getDocs(collection(db, collectionName))
    return sortLatestFirst(snap.docs.map(item => docToExport(item.id, item.data())))
}

async function loadDocsByField(collectionName: string, fieldName: string, values: string[]) {
    const byId = new Map<string, Record<string, unknown>>()

    await Promise.all(values.map(async value => {
        const snap = await getDocs(query(collection(db, collectionName), where(fieldName, "==", value)))
        snap.docs.forEach(item => byId.set(item.id, docToExport(item.id, item.data())))
    }))

    return sortLatestFirst(Array.from(byId.values()))
}

async function loadDocsByArrayContains(collectionName: string, fieldName: string, values: string[]) {
    const byId = new Map<string, Record<string, unknown>>()

    await Promise.all(values.map(async value => {
        const snap = await getDocs(query(collection(db, collectionName), where(fieldName, "array-contains", value)))
        snap.docs.forEach(item => byId.set(item.id, docToExport(item.id, item.data())))
    }))

    return sortLatestFirst(Array.from(byId.values()))
}

export default function AdminBackupPage() {
    const lang = getLang()
    const user = getLocalUser()
    const text = lang === "pl"
        ? {
            title: "Kopie zapasowe",
            intro: "MVP export danych do JSON. To nie jest pełny disaster recovery, ale pomaga szybko pobrać najważniejsze kolekcje przed większymi zmianami.",
            export: "Eksportuj JSON",
            loading: "Eksport...",
            count: "Elementów",
            noCount: "liczenie...",
            success: "Export gotowy",
            error: "Nie udało się wykonać exportu",
            storageTitle: "Firebase Storage",
            storageInfo: "Zdjęcia ogłoszeń i aukcji są przechowywane osobno w Firebase Storage, głównie w ścieżkach ads/{userId}/... oraz auctions/{userId}/.... Ten export pobiera dokumenty Firestore z URL obrazów, ale nie kopiuje samych plików. Dla pełnej kopii Storage trzeba później dodać osobną strategię.",
            safety: "Export nie zawiera env/secrets ani konfiguracji prywatnych kluczy.",
            singleUserTitle: "Export historii jednego użytkownika",
            singleUserPlaceholder: "Email / userId / uid",
            singleUserButton: "Eksportuj historię użytkownika",
            userRequired: "Podaj email, userId albo uid.",
            collections: {
                users: ["Użytkownicy", "Profile użytkowników i status blokady."],
                ads: ["Ogłoszenia", "Ogłoszenia, statusy, promocje i URL obrazów."],
                auctions: ["Aukcje", "Aukcje, statusy, promocje i podstawowa historia."],
                chats: ["Metadane czatów", "Tylko dokumenty chats, bez pełnej subkolekcji messages."],
                reports: ["Zgłoszenia", "Zgłoszenia i decyzje moderacji."],
                payments: ["Płatności", "Historia płatności za promowanie."],
            },
        }
        : {
            title: "Резервні копії",
            intro: "MVP export даних у JSON. Це ще не повна disaster recovery система, але дозволяє швидко завантажити ключові колекції перед великими змінами.",
            export: "Експортувати JSON",
            loading: "Експорт...",
            count: "Елементів",
            noCount: "рахуємо...",
            success: "Export готовий",
            error: "Не вдалося виконати export",
            storageTitle: "Firebase Storage",
            storageInfo: "Фото оголошень і аукціонів зберігаються окремо у Firebase Storage, переважно в шляхах ads/{userId}/... та auctions/{userId}/.... Цей export завантажує Firestore-документи з URL зображень, але не копіює самі файли. Для повного backup Storage потрібна окрема стратегія пізніше.",
            safety: "Export не містить env/secrets або приватні ключі конфігурації.",
            singleUserTitle: "Export історії одного користувача",
            singleUserPlaceholder: "Email / userId / uid",
            singleUserButton: "Експортувати історію користувача",
            userRequired: "Вкажіть email, userId або uid.",
            collections: {
                users: ["Користувачі", "Профілі користувачів і статус блокування."],
                ads: ["Оголошення", "Оголошення, статуси, просування і URL зображень."],
                auctions: ["Аукціони", "Аукціони, статуси, просування і базова історія."],
                chats: ["Метадані чатів", "Тільки документи chats, без повної subcollection messages."],
                reports: ["Скарги", "Скарги і рішення модерації."],
                payments: ["Платежі", "Історія оплат за просування."],
            },
        }

    const exportConfigs: ExportConfig[] = useMemo(() => [
        { key: "users", collectionName: "users", title: text.collections.users[0], description: text.collections.users[1] },
        { key: "ads", collectionName: "ads", title: text.collections.ads[0], description: text.collections.ads[1] },
        { key: "auctions", collectionName: "auctions", title: text.collections.auctions[0], description: text.collections.auctions[1] },
        { key: "chats", collectionName: "chats", title: text.collections.chats[0], description: text.collections.chats[1] },
        { key: "reports", collectionName: "reports", title: text.collections.reports[0], description: text.collections.reports[1] },
        { key: "payments", collectionName: "payments", title: text.collections.payments[0], description: text.collections.payments[1] },
    ], [text.collections.ads, text.collections.auctions, text.collections.chats, text.collections.payments, text.collections.reports, text.collections.users])

    const [counts, setCounts] = useState<Partial<Record<ExportKey, number>>>({})
    const [loadingKey, setLoadingKey] = useState<ExportKey | null>(null)
    const [status, setStatus] = useState<ExportStatus | null>(null)
    const [singleUserId, setSingleUserId] = useState("")

    useEffect(() => {
        let cancelled = false

        ;(async () => {
            const entries = await Promise.all(exportConfigs.map(async config => {
                const countSnap = await getCountFromServer(collection(db, config.collectionName))
                return [config.key, countSnap.data().count] as const
            }))

            if (!cancelled) setCounts(Object.fromEntries(entries))
        })().catch(() => {
            if (!cancelled) setStatus({ type: "error", message: text.error })
        })

        return () => {
            cancelled = true
        }
    }, [exportConfigs, text.error])

    async function exportCollection(config: ExportConfig) {
        setLoadingKey(config.key)
        setStatus(null)

        try {
            const items = await loadCollectionDocs(config.collectionName)
            const exportedAt = new Date().toISOString()
            downloadJson(`xoven-${config.collectionName}-${exportedAt.slice(0, 10)}.json`, {
                app: "Xoven",
                exportType: "collection",
                collection: config.collectionName,
                exportedAt,
                exportedBy: user?.email ?? user?.id ?? null,
                count: items.length,
                items,
            })
            setCounts(prev => ({ ...prev, [config.key]: items.length }))
            setStatus({ type: "success", message: `${text.success}: ${config.title} (${items.length})` })
        } catch (error) {
            console.error(error)
            setStatus({ type: "error", message: text.error })
        } finally {
            setLoadingKey(null)
        }
    }

    async function exportSingleUserHistory() {
        const raw = singleUserId.trim()
        if (!raw) {
            setStatus({ type: "error", message: text.userRequired })
            return
        }

        setLoadingKey("userHistory")
        setStatus(null)

        try {
            const normalized = raw.toLowerCase()
            const directSnap = await getDoc(doc(db, "users", normalized))
            const uidSnap = await getDocs(query(collection(db, "users"), where("uid", "==", raw)))
            const emailSnap = await getDocs(query(collection(db, "users"), where("email", "==", normalized)))
            const userDocs = new Map<string, Record<string, unknown>>()

            if (directSnap.exists()) userDocs.set(directSnap.id, docToExport(directSnap.id, directSnap.data()))
            uidSnap.docs.forEach(item => userDocs.set(item.id, docToExport(item.id, item.data())))
            emailSnap.docs.forEach(item => userDocs.set(item.id, docToExport(item.id, item.data())))

            const exportedUsers = Array.from(userDocs.values())
            const userIds = unique([
                raw,
                normalized,
                ...exportedUsers.flatMap(item => [
                    typeof item.id === "string" ? item.id : null,
                    typeof item.uid === "string" ? item.uid : null,
                    typeof item.email === "string" ? item.email : null,
                ]),
            ])

            const [ads, auctions, allReports, chatsByUser] = await Promise.all([
                loadDocsByField("ads", "userId", userIds),
                loadDocsByField("auctions", "ownerId", userIds),
                loadCollectionDocs("reports"),
                loadDocsByArrayContains("chats", "users", userIds),
            ])

            const adIds = new Set(ads.map(item => String(item.id)))
            const auctionIds = new Set(auctions.map(item => String(item.id)))
            const userIdSet = new Set(userIds)
            const reports = allReports.filter(report => {
                const targetType = typeof report.targetType === "string" ? report.targetType : report.type
                const targetId = typeof report.targetId === "string" ? report.targetId : report.messageId
                return userIdSet.has(String(report.reporterId ?? "")) ||
                    userIdSet.has(String(report.reportedBy ?? "")) ||
                    userIdSet.has(String(report.reportedUserId ?? "")) ||
                    userIdSet.has(String(report.senderId ?? "")) ||
                    (targetType === "ad" && adIds.has(String(targetId))) ||
                    (targetType === "auction" && auctionIds.has(String(targetId)))
            })

            const exportedAt = new Date().toISOString()
            downloadJson(`xoven-user-history-${safeFilePart(raw)}-${exportedAt.slice(0, 10)}.json`, {
                app: "Xoven",
                exportType: "single-user-history",
                exportedAt,
                exportedBy: user?.email ?? user?.id ?? null,
                requestedUser: raw,
                matchedUserIds: userIds,
                user: exportedUsers,
                ads,
                auctions,
                reports,
                chatsMetadata: chatsByUser,
                note: "Chat messages subcollections are not included in this MVP export.",
            })
            setStatus({ type: "success", message: `${text.success}: ${raw}` })
        } catch (error) {
            console.error(error)
            setStatus({ type: "error", message: text.error })
        } finally {
            setLoadingKey(null)
        }
    }

    return (
        <div className="stack12">
            <h2 className="h2">{text.title}</h2>

            <div className="card stack8">
                <p style={{ margin: 0, color: "#4b5563" }}>{text.intro}</p>
                <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>{text.safety}</p>
            </div>

            {status && (
                <div
                    className="card"
                    style={{
                        borderColor: status.type === "success" ? "#bbf7d0" : "#fecaca",
                        background: status.type === "success" ? "#f0fdf4" : "#fef2f2",
                        color: status.type === "success" ? "#166534" : "#991b1b",
                    }}
                >
                    {status.message}
                </div>
            )}

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                {exportConfigs.map(config => (
                    <div key={config.key} className="card stack8">
                        <div>
                            <b>{config.title}</b>
                            <div style={{ color: "#6b7280", fontSize: 13 }}>{config.description}</div>
                        </div>
                        <div style={{ color: "#4b5563", fontSize: 13 }}>
                            {text.count}: {counts[config.key] ?? text.noCount}
                        </div>
                        <button
                            type="button"
                            className="btn-secondary"
                            disabled={loadingKey !== null}
                            onClick={() => void exportCollection(config)}
                        >
                            {loadingKey === config.key ? text.loading : text.export}
                        </button>
                    </div>
                ))}
            </div>

            <div className="card stack8">
                <h3 style={{ margin: 0 }}>{text.singleUserTitle}</h3>
                <input
                    className="input"
                    value={singleUserId}
                    onChange={event => setSingleUserId(event.target.value)}
                    placeholder={text.singleUserPlaceholder}
                    style={{ maxWidth: 520 }}
                />
                <button
                    type="button"
                    className="btn-secondary"
                    disabled={loadingKey !== null}
                    onClick={() => void exportSingleUserHistory()}
                    style={{ width: "fit-content" }}
                >
                    {loadingKey === "userHistory" ? text.loading : text.singleUserButton}
                </button>
            </div>

            <div className="card stack8">
                <h3 style={{ margin: 0 }}>{text.storageTitle}</h3>
                <p style={{ margin: 0, color: "#4b5563" }}>{text.storageInfo}</p>
            </div>
        </div>
    )
}
