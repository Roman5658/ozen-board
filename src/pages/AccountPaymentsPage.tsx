import { useEffect, useState } from "react"
import { collection, getDocs, query, where } from "firebase/firestore"
import { Link } from "react-router-dom"
import { db } from "../app/firebase"
import { getLocalUser } from "../data/localUser"
import type { translations } from "../app/i18n"

type Props = {
    t: (typeof translations)[keyof typeof translations]
}

type Payment = {
    id: string
    createdAt?: unknown
    capturedAt?: unknown
    amount?: string | number | null
    currency?: string | null
    targetType?: "ad" | "auction" | string | null
    promotionType?: string | null
    status?: string | null
    orderId?: string | null
    targetId?: string | null
    userId?: string | null
    userEmail?: string | null
    payerEmail?: string | null
}

function toMillis(value: unknown): number | null {
    if (typeof value === "number") return value
    if (value && typeof value === "object" && "toMillis" in value) {
        const maybeTimestamp = value as { toMillis?: () => number }
        return maybeTimestamp.toMillis?.() ?? null
    }

    return null
}

function getPaymentTime(payment: Payment): number | null {
    return toMillis(payment.capturedAt) ?? toMillis(payment.createdAt)
}

function getTargetPath(payment: Payment): string | null {
    if (!payment.targetId) return null
    if (payment.targetType === "auction") return `/auction/${payment.targetId}`
    if (payment.targetType === "ad") return `/ad/${payment.targetId}`
    return null
}

function AccountPaymentsPage({ t }: Props) {
    const [user] = useState(() => getLocalUser())
    const p = t.account.payments
    const [payments, setPayments] = useState<Payment[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!user) {
            setLoading(false)
            return
        }
        const currentUser = user

        async function loadPayments() {
            const values = Array.from(new Set([
                currentUser.id,
                currentUser.uid,
                currentUser.email?.toLowerCase(),
            ].filter((value): value is string => !!value)))

            const queries = [
                ...values.map((value) => query(collection(db, "payments"), where("userId", "==", value))),
                ...values.map((value) => query(collection(db, "payments"), where("userEmail", "==", value))),
                ...values.map((value) => query(collection(db, "payments"), where("payerEmail", "==", value))),
            ]

            const snapshots = await Promise.all(queries.map((paymentQuery) => getDocs(paymentQuery)))
            const byId = new Map<string, Payment>()

            snapshots.forEach((snapshot) => {
                snapshot.docs.forEach((docSnap) => {
                    byId.set(docSnap.id, {
                        id: docSnap.id,
                        ...(docSnap.data() as Omit<Payment, "id">),
                    })
                })
            })

            setPayments(
                Array.from(byId.values()).sort((a, b) => {
                    return (getPaymentTime(b) ?? 0) - (getPaymentTime(a) ?? 0)
                })
            )
        }

        setLoading(true)
        setError(null)
        loadPayments()
            .catch((err) => {
                console.error(err)
                setError(p.loadError)
            })
            .finally(() => setLoading(false))
    }, [p.loadError, user])

    if (!user) {
        return (
            <div className="card stack12">
                <h2 className="h2">{p.title}</h2>
                <div style={{color: "#6b7280", fontSize: 14}}>{p.authRequired}</div>
            </div>
        )
    }

    return (
        <div className="card stack12">
            <div>
                <Link to="/account" style={{fontSize: 14, color: "#2563eb"}}>
                    {p.back}
                </Link>
            </div>

            <h2 className="h2">{p.title}</h2>

            {loading && <div>{p.loading}</div>}
            {error && <div style={{color: "#b91c1c", fontSize: 14}}>{error}</div>}

            {!loading && !error && payments.length === 0 && (
                <div style={{color: "#6b7280", fontSize: 14}}>{p.empty}</div>
            )}

            {!loading && !error && payments.length > 0 && (
                <div className="stack8">
                    {payments.map((payment) => {
                        const paidAt = getPaymentTime(payment)
                        const targetPath = getTargetPath(payment)

                        return (
                            <div
                                key={payment.id}
                                className="stack8"
                                style={{
                                    border: "1px solid #e5e7eb",
                                    borderRadius: 8,
                                    padding: 12,
                                }}
                            >
                                <div style={{display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap"}}>
                                    <strong>
                                        {payment.amount ?? "-"} {payment.currency ?? ""}
                                    </strong>
                                    <span style={{fontSize: 13, color: "#6b7280"}}>
                                        {paidAt ? new Date(paidAt).toLocaleString(p.locale) : "-"}
                                    </span>
                                </div>

                                <div style={{fontSize: 14}}>
                                    {p.type}: <strong>{payment.targetType ?? "-"}</strong>
                                </div>
                                <div style={{fontSize: 14}}>
                                    {p.promotionType}: <strong>{payment.promotionType ?? "-"}</strong>
                                </div>
                                <div style={{fontSize: 14}}>
                                    {p.status}: <strong>{payment.status ?? "-"}</strong>
                                </div>
                                <div style={{fontSize: 13, color: "#6b7280", wordBreak: "break-all"}}>
                                    {p.orderId}: {payment.orderId ?? payment.id}
                                </div>

                                {payment.targetId ? (
                                    <div style={{fontSize: 14}}>
                                        {p.targetId}:{" "}
                                        {targetPath ? (
                                            <Link to={targetPath} style={{color: "#2563eb"}}>
                                                {payment.targetId}
                                            </Link>
                                        ) : (
                                            payment.targetId
                                        )}
                                    </div>
                                ) : (
                                    <div style={{fontSize: 14, color: "#92400e"}}>
                                        {p.pendingPublication}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

export default AccountPaymentsPage
