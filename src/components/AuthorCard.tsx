import { useEffect, useMemo, useState } from "react"
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore"
import { Link, useNavigate } from "react-router-dom"
import { db } from "../app/firebase"
import type { UserReview } from "../types/userReview"
import { getLocalUser } from "../data/localUser"
import { getOrCreateChat } from "../data/chats"

type Props = {
    userId: string
    hideActions?: boolean
    adId?: string
    adTitle?: string
    onReport?: () => void
}

type PublicUser = { nickname: string; karma: number; phone?: string | null; telegram?: string | null }

function AuthorCard({ userId, hideActions, adId, adTitle, onReport }: Props) {
    const [user, setUser] = useState<PublicUser | null>(null)
    const [reviews, setReviews] = useState<UserReview[]>([])
    const [showReview, setShowReview] = useState(false)
    const [comment, setComment] = useState("")
    const [rating, setRating] = useState<number>(5)
    const [karmaValue, setKarmaValue] = useState<-1 | 1>(1)
    const [role, setRole] = useState<'seller' | 'buyer'>('seller')
    const [loading, setLoading] = useState(true)
    const navigate = useNavigate()
    const currentUser = getLocalUser()
    const isMe = currentUser?.id === userId

    useEffect(() => { (async () => {
        try {
            const snap = await getDoc(doc(db, "users", userId))
            if (snap.exists()) {
                const data = snap.data()
                setUser({ nickname: data.nickname ?? "Користувач", karma: typeof data.karma === "number" ? data.karma : 0, phone: data.phone ?? null, telegram: data.telegram ?? null })
            }
            const rs = await getDocs(query(collection(db, 'userReviews'), where('targetUserId', '==', userId)))
            setReviews(rs.docs.map(d => ({ id: d.id, ...(d.data() as Omit<UserReview, 'id'>) })))
        } finally { setLoading(false) }
    })() }, [userId])

    const stats = useMemo(() => {
        const count = reviews.length
        const avg = count ? (reviews.reduce((s, r) => s + (r.rating ?? 0), 0) / count) : 0
        const karma = reviews.reduce((s, r) => s + (r.karmaValue ?? 0), 0)
        return { count, avg, karma }
    }, [reviews])

    async function submitReview() {
        if (!currentUser || !adId || !adTitle || isMe) return
        const text = comment.trim()
        if (!text) return alert('Комментарий обязателен')
        if (!rating && !karmaValue) return alert('Оценка обязательна')
        const q = query(collection(db, 'userReviews'), where('targetUserId', '==', userId), where('authorUserId', '==', currentUser.id), where('adId', '==', adId))
        const existing = await getDocs(q)
        const payload = { targetUserId: userId, targetUserName: user?.nickname ?? '', authorUserId: currentUser.id, authorUserName: currentUser.nickname ?? '', adId, adTitle, rating, karmaValue, comment: text, role, createdAt: Date.now(), updatedAt: serverTimestamp() }
        if (existing.empty) await addDoc(collection(db, 'userReviews'), payload)
        else await updateDoc(existing.docs[0].ref, payload)
        setReviews(prev => [...prev.filter(r => !(r.authorUserId === currentUser.id && r.adId === adId)), { id: existing.docs[0]?.id ?? 'local', ...payload } as UserReview])
        setShowReview(false); setComment('')
    }

    if (loading || !user) return <div style={{ fontSize: 13, color: "#6b7280" }}>{loading ? 'Завантаження продавця…' : 'Користувача не знайдено'}</div>

    return <div style={{ padding: 12, borderRadius: 12, background: "#f9fafb", border: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
            <div style={{ fontSize: 13, color: "#6b7280" }}>Продавець</div>
            <Link to={`/user/${userId}`} style={{ fontWeight: 700, color: "#1976d2", textDecoration: "none", display: "inline-block", marginTop: 2 }}>{user.nickname}</Link>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>Репутація: {stats.karma >= 0 ? `+${stats.karma}` : stats.karma}</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>Відгуки: {stats.count} · Рейтинг: {stats.avg.toFixed(1)}</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>Карма профілю: {user.karma}</div>
        </div>
        {!hideActions && !isMe && currentUser && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={async () => navigate(`/chat/${await getOrCreateChat(currentUser.id, userId)}`)}>Написати</button>
            <button className="btn-secondary" onClick={() => setShowReview(true)} disabled={!adId}>Оставить отзыв</button>
            <button className="btn-secondary" onClick={onReport}>Пожаловаться</button>
            <Link to={`/user/${userId}`} className="btn-secondary">Профіль</Link>
        </div>}
        {showReview && <div className="card stack12" style={{ width: '100%' }}>
            <h4>Відгук</h4>
            <textarea className='input' value={comment} onChange={e => setComment(e.target.value)} placeholder='Комментарий обязателен' rows={3} />
            <input className='input' type='number' min={1} max={5} value={rating} onChange={e => setRating(Number(e.target.value))} />
            <div style={{ display: 'flex', gap: 8 }}><button className='btn-secondary' onClick={() => setKarmaValue(1)}>+1</button><button className='btn-secondary' onClick={() => setKarmaValue(-1)}>-1</button></div>
            <select className='input' value={role} onChange={e => setRole(e.target.value as 'seller' | 'buyer')}><option value='seller'>seller</option><option value='buyer'>buyer</option></select>
            <button className='btn-primary' onClick={submitReview}>Сохранить отзыв</button>
        </div>}
    </div>
}

export default AuthorCard
