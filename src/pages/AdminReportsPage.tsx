import { useEffect, useMemo, useState } from "react"
import { collection, deleteDoc, doc, getDocs, updateDoc } from "firebase/firestore"
import { db } from "../app/firebase"
import { getLocalUser } from "../data/localUser"

import type { Report, ReportStatus } from "../types/report"
import type { UserReview } from "../types/userReview"

function toMillis(value: unknown): number | null {
    if (typeof value === "number") return value
    if (value && typeof value === "object" && "toMillis" in value) {
        const timestamp = value as { toMillis?: () => number }
        return timestamp.toMillis?.() ?? null
    }

    return null
}

export default function AdminReportsPage() {
    const [reports, setReports] = useState<Report[]>([])
    const [reviews, setReviews] = useState<UserReview[]>([])
    const [tab, setTab] = useState<'reports' | 'reviews' | 'karma'>('reports')

    useEffect(() => { (async () => {
        const [rSnap, vSnap] = await Promise.all([getDocs(collection(db, 'reports')), getDocs(collection(db, 'userReviews'))])
        setReports(rSnap.docs.map(d => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const x = d.data() as any
            const targetType = x.targetType === 'auction' ? 'auction' : 'ad'
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
            }
        }))
        setReviews(vSnap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<UserReview, 'id'>) })))
    })() }, [])

    const badKarma = useMemo(() => {
        const map: Record<string, { name: string; karma: number; count: number }> = {}
        reviews.forEach(r => { const k = r.targetUserId; map[k] ??= { name: r.targetUserName ?? k, karma: 0, count: 0 }; map[k].karma += r.karmaValue ?? 0; map[k].count += 1 })
        return Object.entries(map).filter(([, v]) => v.karma < 0).sort((a, b) => a[1].karma - b[1].karma)
    }, [reviews])

    async function setStatus(reportId: string, status: ReportStatus) {
        const admin = getLocalUser()
        const reviewedAt = Date.now()
        const reviewedBy = admin?.uid || admin?.id || admin?.email || 'admin'

        await updateDoc(doc(db, 'reports', reportId), { status, reviewedAt, reviewedBy })
        setReports(prev => prev.map(r => r.id === reportId ? { ...r, status, reviewedAt, reviewedBy } : r))
    }

    return <div className='stack12'>
        <h2 className='h2'>Репутація / Скарги</h2>
        <div style={{ display: 'flex', gap: 8 }}><button className='btn-secondary' onClick={() => setTab('reports')}>Жалобы</button><button className='btn-secondary' onClick={() => setTab('reviews')}>Отзывы</button><button className='btn-secondary' onClick={() => setTab('karma')}>Плохая карма</button></div>
        {tab === 'reports' && reports.map(r => <div key={r.id} className='card stack8'><div><b>{r.status}</b> · {new Date(r.createdAt).toLocaleString()}</div><div>Target: <b>{r.targetType}</b> · {r.targetId || 'unknown'}</div><div>Reporter: {r.reporterId || 'unknown'}</div><div>Reason: {r.reason || '—'}</div><div>{r.description}</div>{r.reviewedBy && <div style={{fontSize:13,color:'#6b7280'}}>Reviewed by {r.reviewedBy} · {r.reviewedAt ? new Date(r.reviewedAt).toLocaleString() : '—'}</div>}<div style={{display:'flex',gap:8}}><button className='btn-secondary' onClick={() => setStatus(r.id, 'reviewed')}>отметить просмотренной</button><button className='btn-secondary' onClick={() => setStatus(r.id, 'resolved')}>решить</button><button className='btn-danger' onClick={() => setStatus(r.id, 'rejected')}>отклонить</button></div></div>)}
        {tab === 'reviews' && reviews.map(r => <div key={r.id} className='card'><div><b>{r.authorUserName ?? r.authorUserId}</b> → {r.targetUserName ?? r.targetUserId}</div><div>{r.adTitle}</div><div>карма: {r.karmaValue > 0 ? '+1' : '-1'}</div><div>{r.comment}</div><button className='btn-danger' onClick={async () => { await deleteDoc(doc(db, 'userReviews', r.id)); setReviews(prev => prev.filter(x => x.id !== r.id)) }}>Удалить отзыв</button></div>)}
        {tab === 'karma' && badKarma.map(([id, v]) => <div key={id} className='card'>{v.name} ({id}) · карма {v.karma} · отзывов {v.count}</div>)}
    </div>
}
