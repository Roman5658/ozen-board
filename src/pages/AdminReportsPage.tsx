import { useEffect, useMemo, useState } from "react"
import { collection, deleteDoc, doc, getDocs, updateDoc } from "firebase/firestore"
import { db } from "../app/firebase"

import type { Report, ReportStatus } from "../types/report"
import type { UserReview } from "../types/userReview"

export default function AdminReportsPage() {
    const [reports, setReports] = useState<Report[]>([])
    const [reviews, setReviews] = useState<UserReview[]>([])
    const [tab, setTab] = useState<'reports' | 'reviews' | 'karma'>('reports')

    useEffect(() => { (async () => {
        const [rSnap, vSnap] = await Promise.all([getDocs(collection(db, 'reports')), getDocs(collection(db, 'userReviews'))])
        setReports(rSnap.docs.map(d => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const x = d.data() as any
            return { id: d.id, adId: x.adId ?? '', adTitle: x.adTitle ?? '', targetUserId: x.targetUserId ?? x.reportedUserId ?? '', targetUserName: x.targetUserName, reporterUserId: x.reporterUserId, reporterUserName: x.reporterUserName, message: x.message ?? '', reason: x.reason ?? '', createdAt: x.createdAt ?? Date.now(), status: (x.status ?? 'new') as ReportStatus }
        }))
        setReviews(vSnap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<UserReview, 'id'>) })))
    })() }, [])

    const badKarma = useMemo(() => {
        const map: Record<string, { name: string; karma: number; count: number }> = {}
        reviews.forEach(r => { const k = r.targetUserId; map[k] ??= { name: r.targetUserName ?? k, karma: 0, count: 0 }; map[k].karma += r.karmaValue ?? 0; map[k].count += 1 })
        return Object.entries(map).filter(([, v]) => v.karma < 0).sort((a, b) => a[1].karma - b[1].karma)
    }, [reviews])

    async function setStatus(reportId: string, status: ReportStatus) { await updateDoc(doc(db, 'reports', reportId), { status }); setReports(prev => prev.map(r => r.id === reportId ? { ...r, status } : r)) }

    return <div className='stack12'>
        <h2 className='h2'>Репутація / Скарги</h2>
        <div style={{ display: 'flex', gap: 8 }}><button className='btn-secondary' onClick={() => setTab('reports')}>Жалобы</button><button className='btn-secondary' onClick={() => setTab('reviews')}>Отзывы</button><button className='btn-secondary' onClick={() => setTab('karma')}>Плохая карма</button></div>
        {tab === 'reports' && reports.map(r => <div key={r.id} className='card stack8'><div><b>{r.status}</b> · {new Date(r.createdAt).toLocaleString()}</div><div>От: {r.reporterUserName ?? r.reporterUserId ?? 'unknown'} → {r.targetUserName ?? r.targetUserId}</div><div>Объявление: {r.adTitle}</div><div>{r.message}</div><div style={{display:'flex',gap:8}}><button className='btn-secondary' onClick={() => setStatus(r.id, 'reviewed')}>отметить просмотренной</button><button className='btn-secondary' onClick={() => setStatus(r.id, 'resolved')}>решить</button><button className='btn-danger' onClick={() => setStatus(r.id, 'rejected')}>отклонить</button></div></div>)}
        {tab === 'reviews' && reviews.map(r => <div key={r.id} className='card'><div><b>{r.authorUserName ?? r.authorUserId}</b> → {r.targetUserName ?? r.targetUserId}</div><div>{r.adTitle}</div><div>карма: {r.karmaValue > 0 ? '+1' : '-1'}</div><div>{r.comment}</div><button className='btn-danger' onClick={async () => { await deleteDoc(doc(db, 'userReviews', r.id)); setReviews(prev => prev.filter(x => x.id !== r.id)) }}>Удалить отзыв</button></div>)}
        {tab === 'karma' && badKarma.map(([id, v]) => <div key={id} className='card'>{v.name} ({id}) · карма {v.karma} · отзывов {v.count}</div>)}
    </div>
}