import { useEffect, useMemo, useState } from "react"
import { collection, getDocs, orderBy, query } from "firebase/firestore"
import { db } from "../app/firebase"
import { getLocalUser } from "../data/localUser"
import { useNavigate } from "react-router-dom"
import AdminPagination, { getAdminPaginationLabels, paginateItems } from "../components/AdminPagination"

const ADMIN_IDS = ["ozenenesis56@gmail.com"]
const PAGE_SIZE = 30

type Payment = {
    id: string
    createdAt: number
    userId: string | null
    targetType: "ad" | "auction"
    targetId: string
    promotionType: string
    amount: number
    currency: string
    payerEmail?: string | null
    status: string
}

export default function AdminPaymentsPage() {
    const user = getLocalUser()
    const navigate = useNavigate()
    const lang = localStorage.getItem("lang") === "pl" ? "pl" : "uk"
    const paginationLabels = getAdminPaginationLabels(lang)
    const [payments, setPayments] = useState<Payment[]>([])
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(1)

    useEffect(() => {
        const isAdminMode = import.meta.env.VITE_ADMIN_MODE === "true"

        if (!isAdminMode || !user || (!ADMIN_IDS.includes(user.id) && !ADMIN_IDS.includes(user.email))) {
            setLoading(false)
            return
        }


        async function load() {
            const q = query(
                collection(db, "payments"),
                orderBy("createdAt", "desc")
            )

            const snap = await getDocs(q)
            const data = snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as Omit<Payment, "id">),
            }))

            setPayments(data)
            setLoading(false)
        }

        load()
    }, [])

    const isAdminMode = import.meta.env.VITE_ADMIN_MODE === "true"
    const pagedPayments = useMemo(
        () => paginateItems(payments, page, PAGE_SIZE),
        [page, payments]
    )

    if (!isAdminMode || !user || (!ADMIN_IDS.includes(user.id) && !ADMIN_IDS.includes(user.email))) {
        return <div className="card">Немає доступу</div>
    }


    if (loading) {
        return <div className="card">Завантаження платежів…</div>
    }

    return (
        <div className="card stack12">
            <h2 className="h2">Payments</h2>

            {payments.length === 0 ? (
                <div>Платежів немає</div>
            ) : (
                <>
                    <AdminPagination
                        page={page}
                        pageSize={PAGE_SIZE}
                        totalItems={payments.length}
                        labels={paginationLabels}
                        onPageChange={setPage}
                    />

                    <table className="table">
                        <thead>
                        <tr>
                            <th>Дата</th>
                            <th>Тип</th>
                            <th>Promotion</th>
                            <th>Сума</th>
                            <th>Email</th>
                            <th>Дія</th>
                        </tr>
                        </thead>
                        <tbody>
                        {pagedPayments.map(p => (
                            <tr key={p.id}>
                                <td>{new Date(p.createdAt).toLocaleString()}</td>
                                <td>{p.targetType}</td>
                                <td>{p.promotionType}</td>
                                <td>{p.amount} {p.currency}</td>
                                <td>{p.payerEmail ?? "-"}</td>
                                <td>
                                    <button
                                        onClick={() =>
                                            navigate(
                                                p.targetType === "ad"
                                                    ? `/ad/${p.targetId}`
                                                    : `/auction/${p.targetId}`
                                            )
                                        }
                                    >
                                        Перейти
                                    </button>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>

                    {payments.length > PAGE_SIZE && (
                        <AdminPagination
                            page={page}
                            pageSize={PAGE_SIZE}
                            totalItems={payments.length}
                            labels={paginationLabels}
                            onPageChange={setPage}
                        />
                    )}
                </>
            )}
        </div>
    )
}

