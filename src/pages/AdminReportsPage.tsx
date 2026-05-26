import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { collection, deleteDoc, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore"
import { db } from "../app/firebase"
import { getLocalUser } from "../data/localUser"
import { buildAdPath, buildAuctionPath } from "../utils/slug"

import type { translations } from "../app/i18n"
import type { Report, ReportStatus, ReportTargetType } from "../types/report"
import type { UserReview } from "../types/userReview"
import AdminPagination, { getAdminPaginationLabels, paginateItems } from "../components/AdminPagination"

type AppTranslations = (typeof translations)[keyof typeof translations]
type Props = {
    t: AppTranslations
}

const REPORTS_PAGE_SIZE = 20

type TargetInfo = {
    exists: boolean
    title?: string
    ownerId?: string
    status?: string
    url?: string
    loadError?: boolean
}

type ReporterInfo = {
    nickname?: string
    email?: string
}

type ReportedUserInfo = ReporterInfo & {
    docId?: string
    status?: "active" | "blocked"
    blockedReason?: string | null
}

type ModerationAction = 'reviewed' | 'warning' | 'block_user' | 'rejected'

type ModerationForm = {
    report: Report
    action: ModerationAction
    moderationNote: string
    reporterMessage: string
    reportedUserMessage: string
    actionReason: string
}

function toMillis(value: unknown): number | null {
    if (typeof value === "number") return value
    if (value && typeof value === "object" && "toMillis" in value) {
        const timestamp = value as { toMillis?: () => number }
        return timestamp.toMillis?.() ?? null
    }

    return null
}

function targetKey(targetType: ReportTargetType, targetId: string): string {
    return `${targetType}:${targetId}`
}

function isContentReport(report: Report): boolean {
    return report.targetType === 'ad' || report.targetType === 'auction'
}

function moderationStatusRank(status: Report['moderationStatus'], fallback: ReportStatus): number {
    if (status === 'pending' || fallback === 'new' || fallback === 'pending') return 0
    if (status === 'reviewed' || fallback === 'reviewed') return 1
    return 2
}

function isArchivedReport(report: Report): boolean {
    const status = report.moderationStatus ?? report.status
    return status === 'warned' ||
        status === 'user_blocked' ||
        status === 'rejected' ||
        status === 'resolved' ||
        report.status === 'rejected' ||
        report.status === 'resolved'
}

function getAdminId(): string {
    const admin = getLocalUser()
    return admin?.uid || admin?.id || admin?.email || 'admin'
}

function formatTemplate(template: string, values: Record<string, string>): string {
    return Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, value),
        template
    )
}

function getReportSearchText(report: Report, target?: TargetInfo, reporter?: ReporterInfo, reportedUserId?: string | null): string {
    return [
        report.id,
        report.targetType,
        report.targetId,
        report.reporterId,
        reporter?.nickname,
        reporter?.email,
        reportedUserId,
        report.reason,
        report.description,
        report.reasonType,
        report.reasonText,
        report.status,
        report.moderationStatus,
        report.moderationAction,
        report.chatId,
        report.messageId,
        report.senderId,
        report.senderName,
        report.messageText,
        target?.title,
        target?.ownerId,
        target?.status,
    ].filter(Boolean).join(" ").toLowerCase()
}

async function loadTargetInfo(report: Report): Promise<[string, TargetInfo]> {
    const key = targetKey(report.targetType, report.targetId)
    if (report.targetType === 'chat_message') return [key, { exists: false }]
    if (!report.targetId) return [key, { exists: false }]

    try {
        const collectionName = report.targetType === 'auction' ? 'auctions' : 'ads'
        const snap = await getDoc(doc(db, collectionName, report.targetId))

        if (!snap.exists()) return [key, { exists: false }]

        const data = snap.data()
        const title = typeof data.title === 'string' ? data.title : report.targetId
        const city = typeof data.city === 'string' ? data.city : ''
        const ownerId = report.targetType === 'auction'
            ? (typeof data.ownerId === 'string' ? data.ownerId : undefined)
            : (typeof data.userId === 'string' ? data.userId : undefined)
        const status = typeof data.status === 'string' ? data.status : undefined
        const url = report.targetType === 'auction'
            ? buildAuctionPath(title, city, report.targetId)
            : buildAdPath(title, city, report.targetId)

        return [key, { exists: true, title, ownerId, status, url }]
    } catch {
        return [key, { exists: false, loadError: true }]
    }
}

async function loadReporterInfo(reporterId: string): Promise<[string, ReporterInfo]> {
    if (!reporterId) return ['', {}]

    try {
        const directSnap = await getDoc(doc(db, 'users', reporterId))
        if (directSnap.exists()) {
            const data = directSnap.data()
            return [reporterId, {
                nickname: typeof data.nickname === 'string' ? data.nickname : undefined,
                email: typeof data.email === 'string' ? data.email : undefined,
            }]
        }

        const qSnap = await getDocs(query(collection(db, 'users'), where('uid', '==', reporterId)))
        const profile = qSnap.docs[0]?.data()
        if (!profile) return [reporterId, {}]

        return [reporterId, {
            nickname: typeof profile.nickname === 'string' ? profile.nickname : undefined,
            email: typeof profile.email === 'string' ? profile.email : undefined,
        }]
    } catch {
        return [reporterId, {}]
    }
}

async function loadReportedUserInfo(userId: string): Promise<[string, ReportedUserInfo]> {
    if (!userId) return ['', {}]
    const normalized = userId.trim().toLowerCase()

    try {
        const directSnap = await getDoc(doc(db, 'users', normalized))
        if (directSnap.exists()) {
            const data = directSnap.data()
            return [userId, {
                docId: directSnap.id,
                nickname: typeof data.nickname === 'string' ? data.nickname : undefined,
                email: typeof data.email === 'string' ? data.email : undefined,
                status: data.status === 'blocked' ? 'blocked' : 'active',
                blockedReason: typeof data.blockedReason === 'string' ? data.blockedReason : null,
            }]
        }

        const uidSnap = await getDocs(query(collection(db, 'users'), where('uid', '==', userId)))
        const docSnap = uidSnap.docs[0]
        if (!docSnap) return [userId, {}]

        const data = docSnap.data()
        return [userId, {
            docId: docSnap.id,
            nickname: typeof data.nickname === 'string' ? data.nickname : undefined,
            email: typeof data.email === 'string' ? data.email : undefined,
            status: data.status === 'blocked' ? 'blocked' : 'active',
            blockedReason: typeof data.blockedReason === 'string' ? data.blockedReason : null,
        }]
    } catch {
        return [userId, {}]
    }
}

async function findUserDocId(userId: string): Promise<string | null> {
    if (!userId) return null
    const normalized = userId.trim().toLowerCase()

    const directSnap = await getDoc(doc(db, 'users', normalized))
    if (directSnap.exists()) return directSnap.id

    const uidSnap = await getDocs(query(collection(db, 'users'), where('uid', '==', userId)))
    return uidSnap.docs[0]?.id ?? null
}

export default function AdminReportsPage({ t }: Props) {
    const [reports, setReports] = useState<Report[]>([])
    const [targets, setTargets] = useState<Record<string, TargetInfo>>({})
    const [reporters, setReporters] = useState<Record<string, ReporterInfo>>({})
    const [reportedUsers, setReportedUsers] = useState<Record<string, ReportedUserInfo>>({})
    const [reviews, setReviews] = useState<UserReview[]>([])
    const [tab, setTab] = useState<'reports' | 'reviews' | 'karma'>('reports')
    const [reportFilter, setReportFilter] = useState<'active' | 'archived' | 'all'>('active')
    const [reportSearch, setReportSearch] = useState("")
    const [reportPage, setReportPage] = useState(1)
    const [moderationForm, setModerationForm] = useState<ModerationForm | null>(null)
    const [processingAction, setProcessingAction] = useState(false)
    const text = t.adminReports
    const paginationLabels = getAdminPaginationLabels(text.locale === 'pl-PL' ? 'pl' : 'uk')

    useEffect(() => {
        let cancelled = false

        ;(async () => {
            const [rSnap, vSnap] = await Promise.all([
                getDocs(collection(db, 'reports')),
                getDocs(collection(db, 'userReviews')),
            ])

            const loadedReports: Report[] = rSnap.docs.map(d => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const x = d.data() as any
                const isChatMessageReport = x.type === 'chat_message'
                const targetType: ReportTargetType = isChatMessageReport
                    ? 'chat_message'
                    : x.targetType === 'auction'
                        ? 'auction'
                        : 'ad'
                return {
                    id: d.id,
                    targetType,
                    targetId: isChatMessageReport ? (x.messageId ?? '') : (x.targetId ?? x.adId ?? ''),
                    reporterId: x.reporterId ?? x.reporterUserId ?? x.reportedBy ?? '',
                    reason: x.reason ?? 'user-report',
                    description: x.description ?? x.message ?? x.messageText ?? '',
                    reasonType: typeof x.reasonType === 'string' ? x.reasonType : null,
                    reasonText: typeof x.reasonText === 'string' ? x.reasonText : null,
                    createdAt: toMillis(x.createdAt) ?? Date.now(),
                    status: (x.status ?? (isChatMessageReport ? 'pending' : 'new')) as ReportStatus,
                    moderationStatus: typeof x.moderationStatus === 'string' ? x.moderationStatus : (isChatMessageReport ? 'pending' : null),
                    moderationAction: typeof x.moderationAction === 'string' ? x.moderationAction : null,
                    moderationNote: typeof x.moderationNote === 'string' ? x.moderationNote : null,
                    reporterMessage: typeof x.reporterMessage === 'string' ? x.reporterMessage : null,
                    reportedUserMessage: typeof x.reportedUserMessage === 'string' ? x.reportedUserMessage : null,
                    actionReason: typeof x.actionReason === 'string' ? x.actionReason : null,
                    processedAt: toMillis(x.processedAt),
                    processedBy: typeof x.processedBy === 'string' ? x.processedBy : null,
                    reportedUserId: typeof x.reportedUserId === 'string' ? x.reportedUserId : null,
                    reviewedAt: toMillis(x.reviewedAt),
                    reviewedBy: x.reviewedBy ?? null,
                    resolutionNote: typeof x.resolutionNote === 'string' ? x.resolutionNote : null,
                    notificationNeeded: typeof x.notificationNeeded === 'boolean' ? x.notificationNeeded : null,
                    ownerNotified: typeof x.ownerNotified === 'boolean' ? x.ownerNotified : null,
                    reporterNotified: typeof x.reporterNotified === 'boolean' ? x.reporterNotified : null,
                    type: isChatMessageReport ? 'chat_message' : undefined,
                    chatId: typeof x.chatId === 'string' ? x.chatId : undefined,
                    messageId: typeof x.messageId === 'string' ? x.messageId : undefined,
                    senderId: typeof x.senderId === 'string' ? x.senderId : undefined,
                    senderName: typeof x.senderName === 'string' ? x.senderName : null,
                    reportedBy: typeof x.reportedBy === 'string' ? x.reportedBy : undefined,
                    reportedByName: typeof x.reportedByName === 'string' ? x.reportedByName : null,
                    messageText: typeof x.messageText === 'string' ? x.messageText : undefined,
                }
            })

            const reporterIds = Array.from(new Set(loadedReports.map(r => r.reporterId).filter(Boolean)))
            const [targetEntries, reporterEntries] = await Promise.all([
                Promise.all(loadedReports.map(loadTargetInfo)),
                Promise.all(reporterIds.map(loadReporterInfo)),
            ])
            const targetMap = Object.fromEntries(targetEntries)
            const reportedUserIds = Array.from(new Set(
                loadedReports
                    .map(report => {
                        if (report.reportedUserId) return report.reportedUserId
                        if (report.targetType === 'chat_message') return report.senderId ?? null
                        return targetMap[targetKey(report.targetType, report.targetId)]?.ownerId ?? null
                    })
                    .filter((id): id is string => Boolean(id))
            ))
            const reportedUserEntries = await Promise.all(reportedUserIds.map(loadReportedUserInfo))

            if (cancelled) return

            setReports(loadedReports)
            setTargets(targetMap)
            setReporters(Object.fromEntries(reporterEntries))
            setReportedUsers(Object.fromEntries(reportedUserEntries))
            setReviews(vSnap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<UserReview, 'id'>) })))
        })()

        return () => {
            cancelled = true
        }
    }, [])

    const badKarma = useMemo(() => {
        const map: Record<string, { name: string; karma: number; count: number }> = {}
        reviews.forEach(r => { const k = r.targetUserId; map[k] ??= { name: r.targetUserName ?? k, karma: 0, count: 0 }; map[k].karma += r.karmaValue ?? 0; map[k].count += 1 })
        return Object.entries(map).filter(([, v]) => v.karma < 0).sort((a, b) => a[1].karma - b[1].karma)
    }, [reviews])

    const sortedReports = useMemo(() => {
        return [...reports].sort((a, b) => {
            const byStatus = moderationStatusRank(a.moderationStatus, a.status) - moderationStatusRank(b.moderationStatus, b.status)
            if (byStatus !== 0) return byStatus
            return b.createdAt - a.createdAt
        })
    }, [reports])

    const visibleReports = useMemo(() => {
        const q = reportSearch.trim().toLowerCase()
        const byFilter = reportFilter === 'all'
            ? sortedReports
            : sortedReports.filter(report => {
                const archived = isArchivedReport(report)
                return reportFilter === 'archived' ? archived : !archived
            })
        if (!q) return byFilter

        return byFilter.filter(report => {
            const key = targetKey(report.targetType, report.targetId)
            const reportedUserId = report.reportedUserId ?? (report.targetType === 'chat_message' ? report.senderId ?? null : targets[key]?.ownerId ?? null)
            return getReportSearchText(report, targets[key], reporters[report.reporterId], reportedUserId).includes(q)
        })
    }, [reportFilter, reportSearch, reporters, sortedReports, targets])

    const pagedReports = useMemo(
        () => paginateItems(visibleReports, reportPage, REPORTS_PAGE_SIZE),
        [reportPage, visibleReports]
    )

    useEffect(() => {
        setReportPage(1)
    }, [reportFilter, reportSearch])

    function getReportedUserId(report: Report): string | null {
        if (report.reportedUserId) return report.reportedUserId
        if (report.targetType === 'chat_message') return report.senderId ?? null
        const target = targets[targetKey(report.targetType, report.targetId)]
        return target?.ownerId ?? null
    }

    function openModerationAction(report: Report, action: ModerationAction) {
        const defaults = text.moderationDefaults[action]
        setModerationForm({
            report,
            action,
            moderationNote: defaults.moderationNote,
            reporterMessage: defaults.reporterMessage,
            reportedUserMessage: defaults.reportedUserMessage,
            actionReason: defaults.actionReason,
        })
    }

    async function submitModerationAction() {
        if (!moderationForm) return

        const actionReason = moderationForm.actionReason.trim()
        if (!actionReason) {
            alert(text.alerts.reasonRequired)
            return
        }

        const now = Date.now()
        const processedBy = getAdminId()
        const reportedUserId = getReportedUserId(moderationForm.report)
        const moderationStatus =
            moderationForm.action === 'warning'
                ? 'warned'
                : moderationForm.action === 'block_user'
                    ? 'user_blocked'
                    : moderationForm.action
        const status: ReportStatus =
            moderationForm.action === 'reviewed'
                ? 'reviewed'
                : moderationForm.action === 'rejected'
                    ? 'rejected'
                    : 'resolved'
        const patch: Partial<Report> & Record<string, unknown> = {
            status,
            moderationStatus,
            moderationAction: moderationForm.action,
            moderationNote: moderationForm.moderationNote.trim(),
            reporterMessage: moderationForm.reporterMessage.trim(),
            reportedUserMessage: moderationForm.reportedUserMessage.trim(),
            actionReason,
            processedAt: now,
            processedBy,
            reviewedAt: now,
            reviewedBy: processedBy,
            resolutionNote: moderationForm.moderationNote.trim(),
            notificationNeeded: true,
            reporterNotified: false,
            ownerNotified: false,
            reportedUserId: reportedUserId ?? null,
        }

        setProcessingAction(true)
        try {
            if (moderationForm.action === 'block_user') {
                if (!reportedUserId) {
                    alert(text.alerts.reportedUserMissing)
                    return
                }

                const userDocId = await findUserDocId(reportedUserId)
                if (!userDocId) {
                    alert(text.alerts.reportedUserMissing)
                    return
                }

                await updateDoc(doc(db, 'users', userDocId), {
                    status: 'blocked',
                    blockedAt: now,
                    blockedBy: processedBy,
                    blockedReason: actionReason,
                    updatedAt: now,
                })
                setReportedUsers(prev => ({
                    ...prev,
                    [reportedUserId]: {
                        ...prev[reportedUserId],
                        docId: userDocId,
                        status: 'blocked',
                        blockedReason: actionReason,
                    },
                }))
            }

            await updateDoc(doc(db, 'reports', moderationForm.report.id), patch)
            setReports(prev => prev.map(r => r.id === moderationForm.report.id ? { ...r, ...patch } : r))
            setModerationForm(null)
            alert(text.alerts.actionSaved)
        } catch {
            alert(text.alerts.updateError)
        } finally {
            setProcessingAction(false)
        }
    }

    async function unblockReportedUser(report: Report) {
        const reportedUserId = getReportedUserId(report)
        if (!reportedUserId) {
            alert(text.alerts.reportedUserMissing)
            return
        }

        const reason = window.prompt(text.prompts.unblockReason)?.trim()
        if (!reason) {
            alert(text.alerts.unblockReasonRequired)
            return
        }

        const userInfo = reportedUsers[reportedUserId]
        const userDocId = userInfo?.docId ?? await findUserDocId(reportedUserId)
        if (!userDocId) {
            alert(text.alerts.reportedUserMissing)
            return
        }

        const adminId = getAdminId()
        const patch = {
            status: 'active',
            unblockedAt: Date.now(),
            unblockedBy: adminId,
            unblockReason: reason,
            unblockEmailSent: false,
            unblockEmailError: null,
            updatedAt: Date.now(),
        }

        try {
            await updateDoc(doc(db, 'users', userDocId), patch)
            setReportedUsers(prev => ({
                ...prev,
                [reportedUserId]: {
                    ...prev[reportedUserId],
                    docId: userDocId,
                    status: 'active',
                },
            }))
            alert(text.alerts.unblocked)
        } catch {
            alert(text.alerts.updateError)
        }
    }

    async function setTargetHidden(report: Report) {
        if (!isContentReport(report)) return

        const key = targetKey(report.targetType, report.targetId)
        const target = targets[key]
        if (!target?.exists) {
            alert(text.alerts.targetMissing)
            return
        }

        const reason = window.prompt(text.prompts.moderationReason)
        if (reason === null) return

        const trimmedReason = reason.trim()
        if (!trimmedReason) {
            alert(text.alerts.reasonRequired)
            return
        }

        const collectionName = report.targetType === 'auction' ? 'auctions' : 'ads'
        const ownerNotificationMessage = formatTemplate(text.ownerMessages.hidden, {
            targetType: text.targetLabels[report.targetType],
            title: target.title ?? report.targetId,
            reason: trimmedReason,
        })
        const patch = {
            status: 'hidden',
            moderationReason: trimmedReason,
            moderatedAt: Date.now(),
            moderatedBy: getAdminId(),
            restoredAt: null,
            restoredBy: null,
            ownerNotificationStatus: 'unread',
            ownerNotificationMessage,
        }

        try {
            await updateDoc(doc(db, collectionName, report.targetId), patch)
            setTargets(prev => ({ ...prev, [key]: { ...target, status: 'hidden' } }))
            alert(text.alerts.hidden)
        } catch {
            alert(text.alerts.updateError)
        }
    }

    async function restoreTarget(report: Report) {
        if (!isContentReport(report)) return

        const key = targetKey(report.targetType, report.targetId)
        const target = targets[key]
        if (!target?.exists) {
            alert(text.alerts.targetMissing)
            return
        }

        const collectionName = report.targetType === 'auction' ? 'auctions' : 'ads'
        const ownerNotificationMessage = formatTemplate(text.ownerMessages.restored, {
            targetType: text.targetLabels[report.targetType],
            title: target.title ?? report.targetId,
        })
        const patch = {
            status: 'active',
            moderationReason: null,
            restoredAt: Date.now(),
            restoredBy: getAdminId(),
            ownerNotificationStatus: 'unread',
            ownerNotificationMessage,
        }

        try {
            await updateDoc(doc(db, collectionName, report.targetId), patch)
            setTargets(prev => ({ ...prev, [key]: { ...target, status: 'active' } }))
            alert(text.alerts.restored)
        } catch {
            alert(text.alerts.updateError)
        }
    }

    return <div className='stack12'>
        <h2 className='h2'>{text.title}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className='btn-secondary' onClick={() => setTab('reports')}>{text.tabs.reports}</button>
            <button className='btn-secondary' onClick={() => setTab('reviews')}>{text.tabs.reviews}</button>
            <button className='btn-secondary' onClick={() => setTab('karma')}>{text.tabs.karma}</button>
        </div>

        {tab === 'reports' && (
            <>
                <div className='card stack8' style={{ fontSize: 14, color: '#4b5563' }}>
                    <div><b>{text.status.reviewed}</b> — {text.statusHelp.reviewed}</div>
                    <div><b>{text.status.resolved}</b> — {text.statusHelp.resolved}</div>
                    <div><b>{text.status.rejected}</b> — {text.statusHelp.rejected}</div>
                </div>

                <input
                    className='input'
                    value={reportSearch}
                    onChange={event => setReportSearch(event.target.value)}
                    placeholder={text.searchPlaceholder}
                    style={{ maxWidth: 520 }}
                />

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                        className={reportFilter === 'active' ? 'btn-primary' : 'btn-secondary'}
                        type='button'
                        onClick={() => setReportFilter('active')}
                    >
                        {text.filters.active} ({sortedReports.filter(report => !isArchivedReport(report)).length})
                    </button>
                    <button
                        className={reportFilter === 'archived' ? 'btn-primary' : 'btn-secondary'}
                        type='button'
                        onClick={() => setReportFilter('archived')}
                    >
                        {text.filters.archived} ({sortedReports.filter(isArchivedReport).length})
                    </button>
                    <button
                        className={reportFilter === 'all' ? 'btn-primary' : 'btn-secondary'}
                        type='button'
                        onClick={() => setReportFilter('all')}
                    >
                        {text.filters.all} ({sortedReports.length})
                    </button>
                </div>

                {visibleReports.length === 0 && <div className='card'>{text.empty}</div>}

                {visibleReports.length > 0 && (
                    <AdminPagination
                        page={reportPage}
                        pageSize={REPORTS_PAGE_SIZE}
                        totalItems={visibleReports.length}
                        labels={paginationLabels}
                        onPageChange={setReportPage}
                    />
                )}

                {pagedReports.map(r => {
                    const key = targetKey(r.targetType, r.targetId)
                    const target = targets[key]
                    const reporter = reporters[r.reporterId]
                    const targetMissing = target && !target.exists
                    const moderationStatus = r.moderationStatus ?? (r.status === 'new' || r.status === 'pending' ? 'pending' : r.status)
                    const isNewReport = moderationStatus === 'pending'
                    const isChatReport = r.targetType === 'chat_message'
                    const reportedUserId = getReportedUserId(r)
                    const reportedUser = reportedUserId ? reportedUsers[reportedUserId] : undefined
                    const isReportedUserBlocked = reportedUser?.status === 'blocked'

                    return (
                        <div
                            key={r.id}
                            className='card stack8'
                            style={{
                                border: isNewReport ? '2px solid #f59e0b' : '1px solid #e5e7eb',
                                background: isNewReport ? '#fffbeb' : '#fff',
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                <div>
                                    <b>{text.moderationStatus[moderationStatus] ?? text.status[r.status] ?? r.status}</b>
                                    {' · '}
                                    {new Date(r.createdAt).toLocaleString(text.locale)}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    {isNewReport && (
                                        <span className='ad-badge' style={{ background: '#f59e0b', color: '#111827' }}>
                                            {text.moderationStatus[moderationStatus] ?? text.status.new}
                                        </span>
                                    )}
                                    <div style={{ color: '#6b7280', fontSize: 13 }}>{r.id}</div>
                                </div>
                            </div>

                            {isChatReport ? (
                                <div className='stack8' style={{ borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
                                    <div><b>{text.chatReport.title}</b></div>
                                    <div>{text.target.type}: <b>{text.targetLabels.chat_message}</b></div>
                                    <div>{text.chatReport.chatId}: <code>{r.chatId ?? text.unknown}</code></div>
                                    <div>{text.chatReport.messageId}: <code>{r.messageId ?? r.targetId ?? text.unknown}</code></div>
                                    <div>{text.chatReport.sender}: {r.senderName || r.senderId || text.unknown}</div>
                                    {r.chatId && <Link to={`/chat/${r.chatId}`}>{text.chatReport.openChat}</Link>}
                                    <div>{text.chatReport.text}: {r.messageText || r.description || text.unknown}</div>
                                </div>
                            ) : (
                                <div className='stack8' style={{ borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
                                    <div><b>{text.target.title}</b></div>
                                    <div>{text.target.type}: <b>{r.targetType}</b></div>
                                    <div>{text.target.id}: {r.targetId || text.unknown}</div>
                                    {targetMissing ? (
                                        <div style={{ color: target.loadError ? '#b45309' : '#b91c1c' }}>
                                            {target.loadError ? text.target.loadError : text.target.notFound}
                                        </div>
                                    ) : (
                                        <>
                                            <div>{text.target.titleField}: {target?.title ?? text.unknown}</div>
                                            <div>{text.target.owner}: {target?.ownerId ?? text.unknown}</div>
                                            <div>{text.target.status}: {target?.status ?? text.unknown}</div>
                                            {target?.url && <Link to={target.url}>{text.target.open}</Link>}
                                        </>
                                    )}
                                </div>
                            )}

                            <div className='stack8' style={{ borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
                                <div><b>{text.reporter.title}</b></div>
                                <div>{text.reporter.id}: {r.reporterId || text.unknown}</div>
                                {r.reporterId && <Link to={`/user/${r.reporterId}`}>{text.reporter.openProfile}</Link>}
                                {(reporter?.nickname || reporter?.email) && (
                                    <div>
                                        {text.reporter.profile}: {reporter.nickname ?? reporter.email}
                                        {reporter.nickname && reporter.email ? ` · ${reporter.email}` : ''}
                                    </div>
                                )}
                            </div>

                            <div><b>{text.fields.reason}:</b> {r.reason || '—'}</div>
                            <div><b>{text.fields.description}:</b> {r.description || '—'}</div>
                            {reportedUserId && (
                                <div>
                                    <b>{text.reportedUser}:</b> {reportedUserId}{' '}
                                    <Link to={`/user/${reportedUserId}`}>{text.reporter.openProfile}</Link>
                                    {isReportedUserBlocked && (
                                        <span className='ad-badge' style={{ marginLeft: 8, background: '#b91c1c' }}>
                                            {text.userStatus.blocked}
                                        </span>
                                    )}
                                </div>
                            )}
                            {reportedUser?.blockedReason && (
                                <div><b>{text.userStatus.blockedReason}:</b> {reportedUser.blockedReason}</div>
                            )}
                            <div><b>{text.fields.reason}:</b> {r.reasonType ? (text.reasonTypes[r.reasonType as keyof typeof text.reasonTypes] ?? r.reasonType) : (r.reason || '—')}</div>
                            <div><b>{text.fields.description}:</b> {r.reasonText || r.description || '—'}</div>
                            {r.moderationAction && <div><b>{text.fields.action}:</b> {text.actionsTaken[r.moderationAction] ?? r.moderationAction}</div>}
                            {r.actionReason && <div><b>{text.fields.actionReason}:</b> {r.actionReason}</div>}
                            {r.moderationNote && <div><b>{text.fields.moderationNote}:</b> {r.moderationNote}</div>}
                            {r.reporterMessage && <div><b>{text.fields.reporterMessage}:</b> {r.reporterMessage}</div>}
                            {r.reportedUserMessage && <div><b>{text.fields.reportedUserMessage}:</b> {r.reportedUserMessage}</div>}
                            {r.processedBy && (
                                <div style={{ fontSize: 13, color: '#6b7280' }}>
                                    {text.fields.processedBy}: {r.processedBy}
                                    {' · '}
                                    {r.processedAt ? new Date(r.processedAt).toLocaleString(text.locale) : '—'}
                                </div>
                            )}
                            {r.resolutionNote && <div><b>{text.fields.resolutionNote}:</b> {r.resolutionNote}</div>}
                            {r.reviewedBy && (
                                <div style={{ fontSize: 13, color: '#6b7280' }}>
                                    {text.fields.reviewedBy}: {r.reviewedBy}
                                    {' · '}
                                    {r.reviewedAt ? new Date(r.reviewedAt).toLocaleString(text.locale) : '—'}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button className='btn-secondary' onClick={() => openModerationAction(r, 'reviewed')}>
                                    {text.actions.markReviewed}
                                </button>
                                <button className='btn-secondary' onClick={() => openModerationAction(r, 'warning')}>
                                    {text.actions.warnUser}
                                </button>
                                {isReportedUserBlocked ? (
                                    <button className='btn-secondary' onClick={() => void unblockReportedUser(r)}>
                                        {text.actions.unblockUser}
                                    </button>
                                ) : (
                                    <button className='btn-danger' onClick={() => openModerationAction(r, 'block_user')}>
                                        {text.actions.blockUser}
                                    </button>
                                )}
                                <button className='btn-danger' onClick={() => openModerationAction(r, 'rejected')}>
                                    {text.actions.reject}
                                </button>
                                {isContentReport(r) && (
                                    target?.exists && target.status === 'hidden' ? (
                                        <button className='btn-secondary' onClick={() => restoreTarget(r)}>
                                            {text.target.restore}
                                        </button>
                                    ) : (
                                        <button className='btn-danger' onClick={() => setTargetHidden(r)} disabled={!target?.exists}>
                                            {text.target.hide}
                                        </button>
                                    )
                                )}
                            </div>
                        </div>
                    )
                })}

                {visibleReports.length > REPORTS_PAGE_SIZE && (
                    <AdminPagination
                        page={reportPage}
                        pageSize={REPORTS_PAGE_SIZE}
                        totalItems={visibleReports.length}
                        labels={paginationLabels}
                        onPageChange={setReportPage}
                    />
                )}
            </>
        )}

        {tab === 'reviews' && reviews.map(r => <div key={r.id} className='card'><div><b>{r.authorUserName ?? r.authorUserId}</b> → {r.targetUserName ?? r.targetUserId}</div><div>{r.adTitle}</div><div>{text.review.karma}: {r.karmaValue > 0 ? '+1' : '-1'}</div><div>{r.comment}</div><button className='btn-danger' onClick={async () => { await deleteDoc(doc(db, 'userReviews', r.id)); setReviews(prev => prev.filter(x => x.id !== r.id)) }}>{text.review.delete}</button></div>)}
        {tab === 'karma' && badKarma.map(([id, v]) => <div key={id} className='card'>{v.name} ({id}) · {text.review.karma} {v.karma} · {text.review.reviewsCount} {v.count}</div>)}
        {moderationForm && (
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(15, 23, 42, 0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 16,
                    zIndex: 60,
                }}
            >
                <div className='card stack12' style={{ width: 'min(640px, 100%)', background: '#fff' }}>
                    <h3 style={{ margin: 0 }}>{text.moderationModal.title}</h3>
                    <div style={{ color: '#475569', fontSize: 14 }}>
                        {text.moderationModal.action}: <b>{text.actionsTaken[moderationForm.action]}</b>
                    </div>
                    <label className='stack8'>
                        <span>{text.moderationModal.actionReason}</span>
                        <input className='input' value={moderationForm.actionReason} onChange={event => setModerationForm({ ...moderationForm, actionReason: event.target.value })} />
                    </label>
                    <label className='stack8'>
                        <span>{text.moderationModal.moderationNote}</span>
                        <textarea className='input' rows={3} value={moderationForm.moderationNote} onChange={event => setModerationForm({ ...moderationForm, moderationNote: event.target.value })} />
                    </label>
                    <label className='stack8'>
                        <span>{text.moderationModal.reporterMessage}</span>
                        <textarea className='input' rows={3} value={moderationForm.reporterMessage} onChange={event => setModerationForm({ ...moderationForm, reporterMessage: event.target.value })} />
                    </label>
                    {(moderationForm.action === 'warning' || moderationForm.action === 'block_user') && (
                        <label className='stack8'>
                            <span>{text.moderationModal.reportedUserMessage}</span>
                            <textarea className='input' rows={3} value={moderationForm.reportedUserMessage} onChange={event => setModerationForm({ ...moderationForm, reportedUserMessage: event.target.value })} />
                        </label>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                        <button className='btn-secondary' type='button' onClick={() => setModerationForm(null)} disabled={processingAction}>{text.moderationModal.cancel}</button>
                        <button className='btn-primary' type='button' onClick={() => void submitModerationAction()} disabled={processingAction}>{text.moderationModal.save}</button>
                    </div>
                </div>
            </div>
        )}
    </div>
}
