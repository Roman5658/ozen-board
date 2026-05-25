import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { collection, deleteDoc, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore"
import { db } from "../app/firebase"
import { sendAdminSystemMessage } from "../data/chats"
import { getLocalUser } from "../data/localUser"
import { buildAdPath, buildAuctionPath } from "../utils/slug"

import type { translations } from "../app/i18n"
import type { Report, ReportStatus, ReportTargetType } from "../types/report"
import type { UserReview } from "../types/userReview"

type AppTranslations = (typeof translations)[keyof typeof translations]
type Props = {
    t: AppTranslations
}

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

function statusRank(status: ReportStatus): number {
    if (status === 'new') return 0
    if (status === 'reviewed') return 1
    return 2
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

async function loadTargetInfo(report: Report): Promise<[string, TargetInfo]> {
    const key = targetKey(report.targetType, report.targetId)
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

export default function AdminReportsPage({ t }: Props) {
    const [reports, setReports] = useState<Report[]>([])
    const [targets, setTargets] = useState<Record<string, TargetInfo>>({})
    const [reporters, setReporters] = useState<Record<string, ReporterInfo>>({})
    const [reviews, setReviews] = useState<UserReview[]>([])
    const [tab, setTab] = useState<'reports' | 'reviews' | 'karma'>('reports')
    const text = t.adminReports

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
                const targetType: ReportTargetType = x.targetType === 'auction' ? 'auction' : 'ad'
                return {
                    id: d.id,
                    targetType,
                    targetId: x.targetId ?? x.adId ?? '',
                    reporterId: x.reporterId ?? x.reporterUserId ?? '',
                    reason: x.reason ?? 'user-report',
                    description: x.description ?? x.message ?? '',
                    createdAt: toMillis(x.createdAt) ?? Date.now(),
                    status: (x.status ?? 'new') as ReportStatus,
                    reviewedAt: toMillis(x.reviewedAt),
                    reviewedBy: x.reviewedBy ?? null,
                    resolutionNote: typeof x.resolutionNote === 'string' ? x.resolutionNote : null,
                    notificationNeeded: typeof x.notificationNeeded === 'boolean' ? x.notificationNeeded : null,
                    ownerNotified: typeof x.ownerNotified === 'boolean' ? x.ownerNotified : null,
                    reporterNotified: typeof x.reporterNotified === 'boolean' ? x.reporterNotified : null,
                }
            })

            const reporterIds = Array.from(new Set(loadedReports.map(r => r.reporterId).filter(Boolean)))
            const [targetEntries, reporterEntries] = await Promise.all([
                Promise.all(loadedReports.map(loadTargetInfo)),
                Promise.all(reporterIds.map(loadReporterInfo)),
            ])

            if (cancelled) return

            setReports(loadedReports)
            setTargets(Object.fromEntries(targetEntries))
            setReporters(Object.fromEntries(reporterEntries))
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
            const byStatus = statusRank(a.status) - statusRank(b.status)
            if (byStatus !== 0) return byStatus
            return b.createdAt - a.createdAt
        })
    }, [reports])

    async function setStatus(reportId: string, status: ReportStatus) {
        const reviewedAt = Date.now()
        const reviewedBy = getAdminId()
        const patch: Partial<Report> & Record<string, unknown> = { status, reviewedAt, reviewedBy }

        if (status === 'resolved' || status === 'rejected') {
            const note = window.prompt(text.prompts.resolutionNote)
            if (note === null) return

            patch.resolutionNote = note.trim()
            patch.notificationNeeded = true
            patch.ownerNotified = false
            patch.reporterNotified = false
        }

        try {
            await updateDoc(doc(db, 'reports', reportId), patch)
            setReports(prev => prev.map(r => r.id === reportId ? { ...r, ...patch } : r))
        } catch {
            alert(text.alerts.updateError)
        }
    }

    async function sendOwnerSystemMessage(
        report: Report,
        target: TargetInfo,
        message: string,
        moderationStatus: 'hidden' | 'restored',
        moderationReason?: string | null
    ) {
        if (!target.ownerId) return

        try {
            await sendAdminSystemMessage({
                adminId: getAdminId(),
                ownerId: target.ownerId,
                text: message,
                targetType: report.targetType,
                targetId: report.targetId,
                targetTitle: target.title,
                moderationStatus,
                moderationReason: moderationReason ?? null,
            })
        } catch (error) {
            console.warn('[admin reports] owner chat notification failed', error)
        }
    }

    async function setTargetHidden(report: Report) {
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
            await sendOwnerSystemMessage(report, target, ownerNotificationMessage, 'hidden', trimmedReason)
            alert(text.alerts.hidden)
        } catch {
            alert(text.alerts.updateError)
        }
    }

    async function restoreTarget(report: Report) {
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
            await sendOwnerSystemMessage(report, target, ownerNotificationMessage, 'restored')
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

                {sortedReports.length === 0 && <div className='card'>{text.empty}</div>}

                {sortedReports.map(r => {
                    const key = targetKey(r.targetType, r.targetId)
                    const target = targets[key]
                    const reporter = reporters[r.reporterId]
                    const targetMissing = target && !target.exists

                    return (
                        <div key={r.id} className='card stack8'>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                <div>
                                    <b>{text.status[r.status] ?? r.status}</b>
                                    {' · '}
                                    {new Date(r.createdAt).toLocaleString(text.locale)}
                                </div>
                                <div style={{ color: '#6b7280', fontSize: 13 }}>{r.id}</div>
                            </div>

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

                            <div className='stack8' style={{ borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
                                <div><b>{text.reporter.title}</b></div>
                                <div>{text.reporter.id}: {r.reporterId || text.unknown}</div>
                                {(reporter?.nickname || reporter?.email) && (
                                    <div>
                                        {text.reporter.profile}: {reporter.nickname ?? reporter.email}
                                        {reporter.nickname && reporter.email ? ` · ${reporter.email}` : ''}
                                    </div>
                                )}
                            </div>

                            <div><b>{text.fields.reason}:</b> {r.reason || '—'}</div>
                            <div><b>{text.fields.description}:</b> {r.description || '—'}</div>
                            {r.resolutionNote && <div><b>{text.fields.resolutionNote}:</b> {r.resolutionNote}</div>}
                            {r.reviewedBy && (
                                <div style={{ fontSize: 13, color: '#6b7280' }}>
                                    {text.fields.reviewedBy}: {r.reviewedBy}
                                    {' · '}
                                    {r.reviewedAt ? new Date(r.reviewedAt).toLocaleString(text.locale) : '—'}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button className='btn-secondary' onClick={() => setStatus(r.id, 'reviewed')}>
                                    {text.actions.markReviewed}
                                </button>
                                <button className='btn-secondary' onClick={() => setStatus(r.id, 'resolved')}>
                                    {text.actions.resolve}
                                </button>
                                <button className='btn-danger' onClick={() => setStatus(r.id, 'rejected')}>
                                    {text.actions.reject}
                                </button>
                                {target?.exists && target.status === 'hidden' ? (
                                    <button className='btn-secondary' onClick={() => restoreTarget(r)}>
                                        {text.target.restore}
                                    </button>
                                ) : (
                                    <button className='btn-danger' onClick={() => setTargetHidden(r)} disabled={!target?.exists}>
                                        {text.target.hide}
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                })}
            </>
        )}

        {tab === 'reviews' && reviews.map(r => <div key={r.id} className='card'><div><b>{r.authorUserName ?? r.authorUserId}</b> → {r.targetUserName ?? r.targetUserId}</div><div>{r.adTitle}</div><div>{text.review.karma}: {r.karmaValue > 0 ? '+1' : '-1'}</div><div>{r.comment}</div><button className='btn-danger' onClick={async () => { await deleteDoc(doc(db, 'userReviews', r.id)); setReviews(prev => prev.filter(x => x.id !== r.id)) }}>{text.review.delete}</button></div>)}
        {tab === 'karma' && badKarma.map(([id, v]) => <div key={id} className='card'>{v.name} ({id}) · {text.review.karma} {v.karma} · {text.review.reviewsCount} {v.count}</div>)}
    </div>
}
