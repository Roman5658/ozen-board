import { useEffect, useMemo, useState } from "react"
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore"
import { Link, useNavigate } from "react-router-dom"
import { db } from "../app/firebase"
import type { UserReview } from "../types/userReview"
import { getLocalUser } from "../data/localUser"
import { getOrCreateChat } from "../data/chats"
import type { translations } from "../app/i18n"

type Props = {
    userId: string
    hideActions?: boolean
    adId?: string
    adTitle?: string
    onReport?: () => void
    t: (typeof translations)[keyof typeof translations]
}

type PublicUser = { nickname: string; karma: number; phone?: string | null; telegram?: string | null }

function AuthorCard({ userId, hideActions, adId, adTitle, onReport, t }: Props) {
    const a = t.authorCard
    const [user, setUser] = useState<PublicUser | null>(null)
    const [reviews, setReviews] = useState<UserReview[]>([])
    const [showReview, setShowReview] = useState(false)
    const [comment, setComment] = useState("")
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
                setUser({ nickname: data.nickname ?? a.userFallback, karma: typeof data.karma === "number" ? data.karma : 0, phone: data.phone ?? null, telegram: data.telegram ?? null })
            }
            const rs = await getDocs(query(collection(db, 'userReviews'), where('targetUserId', '==', userId)))
            setReviews(rs.docs.map(d => ({ id: d.id, ...(d.data() as Omit<UserReview, 'id'>) })))
        } finally { setLoading(false) }
    })() }, [userId, a.userFallback])

    const stats = useMemo(() => {
        const count = reviews.length

        const karma = reviews.reduce((s, r) => s + (r.karmaValue ?? 0), 0)
        return { count, karma }
    }, [reviews])

    async function submitReview() {
        if (!currentUser || !adId || !adTitle || isMe) return
        const text = comment.trim()

        const q = query(collection(db, 'userReviews'), where('targetUserId', '==', userId), where('authorUserId', '==', currentUser.id), where('adId', '==', adId))
        const existing = await getDocs(q)
        const payload = { targetUserId: userId, targetUserName: user?.nickname ?? '', authorUserId: currentUser.id, authorUserName: currentUser.nickname ?? '', adId, adTitle, karmaValue, comment: text, role, createdAt: Date.now(), updatedAt: serverTimestamp() }
        if (existing.empty) await addDoc(collection(db, 'userReviews'), payload)
        else await updateDoc(existing.docs[0].ref, payload)
        setReviews(prev => [...prev.filter(r => !(r.authorUserId === currentUser.id && r.adId === adId)), { id: existing.docs[0]?.id ?? 'local', ...payload } as UserReview])
        setShowReview(false); setComment('')
    }

    if (loading || !user) return <div style={{ fontSize: 13, color: "#6b7280" }}>{loading ? a.loading : a.notFound}</div>

    return <div style={{ padding: 12, borderRadius: 12, background: "#f9fafb", border: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
            <div style={{fontSize: 13, color: "#6b7280"}}>{a.seller}</div>
            <Link to={`/user/${userId}`} style={{
                fontWeight: 700,
                color: "#1976d2",
                textDecoration: "none",
                display: "inline-block",
                marginTop: 2
            }}>{user.nickname}</Link>
            <div style={{
                fontSize: 13,
                color: "#6b7280",
                marginTop: 2
            }}>{a.reputation}: {stats.karma >= 0 ? `+${stats.karma}` : stats.karma}</div>
            <div style={{
                fontSize: 13,
                color: "#6b7280",
                marginTop: 2
            }}>{a.reviews}: {stats.count}</div>
            <div style={{fontSize: 13, color: "#6b7280", marginTop: 2}}>{a.profileKarma}: {user.karma}</div>
        </div>

        {!hideActions && !isMe && currentUser && <div style={{display: "flex", gap: 8, flexWrap: "wrap"}}>
            <button className="btn-primary"
                    onClick={async () => navigate(`/chat/${await getOrCreateChat(currentUser.id, userId)}`)}>{a.write}</button>
            <button className="btn-secondary" onClick={() => setShowReview(true)}
                    disabled={!adId}>{a.leaveReview}</button>
            <button className="btn-secondary" onClick={onReport}>{a.report}</button>
            <Link to={`/user/${userId}`} className="btn-secondary">{a.profile}</Link>
        </div>}
        {showReview && <div className="card stack12" style={{width: '100%'}}>
            <h4>{a.reviewTitle}</h4>
            <textarea className='input' value={comment} onChange={e => setComment(e.target.value)}
                      placeholder={'Комментарий (необязательно)'} rows={3}/>
            <div style={{display: 'flex', gap: 8}}>
                <button className='btn-secondary' onClick={() => setKarmaValue(1)}>+1</button>
                <button className='btn-secondary' onClick={() => setKarmaValue(-1)}>-1</button>
            </div>
            <select className='input' value={role} onChange={e => setRole(e.target.value as 'seller' | 'buyer')}>
                <option value='seller'>{a.roleSeller}</option>
                <option value='buyer'>{a.roleBuyer}</option>
            </select>
            <button className='btn-primary' onClick={submitReview}>{a.saveReview}</button>
        </div>}
    </div>
}

export default AuthorCard
