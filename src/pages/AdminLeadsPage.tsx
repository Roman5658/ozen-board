import { useEffect, useMemo, useState } from "react"
import { collection, doc, getDocs, orderBy, query, updateDoc } from "firebase/firestore"
import { importOlxLeads } from "../api/leads"
import { db } from "../app/firebase"
import type { Lead, LeadAudience, LeadCategory, LeadStatus } from "../types/lead"

const STATUS_ACTIONS: Array<{ status: LeadStatus; label: string }> = [
    { status: "wrote", label: "Написал" },
    { status: "replied", label: "Ответил" },
    { status: "posted", label: "Разместил" },
    { status: "rejected", label: "Отказ" },
]

const STATUS_LABELS: Record<LeadStatus, string> = {
    new: "Новый",
    wrote: "Написал",
    replied: "Ответил",
    posted: "Разместил",
    rejected: "Отказ",
}

const CATEGORY_LABELS: Record<LeadCategory, string> = {
    jobs: "Работа",
    sales: "Продажи",
    services: "Услуги",
    rent: "Аренда",
    other: "Другое",
}

function AdminLeadsPage() {
    const [leads, setLeads] = useState<Lead[]>([])
    const [loading, setLoading] = useState(true)
    const [importing, setImporting] = useState(false)
    const [copiedLeadId, setCopiedLeadId] = useState<string | null>(null)
    const [message, setMessage] = useState("")
    const [searchUrl, setSearchUrl] = useState("")
    const [audience, setAudience] = useState<LeadAudience>("pl")
    const [category, setCategory] = useState<LeadCategory>("other")
    const [city, setCity] = useState("")
    const [limit, setLimit] = useState(20)

    async function loadLeads() {
        setLoading(true)
        try {
            const snap = await getDocs(query(collection(db, "leads"), orderBy("createdAt", "desc")))
            setLeads(snap.docs.map(item => ({
                id: item.id,
                ...(item.data() as Omit<Lead, "id">),
            })))
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        void loadLeads()
    }, [])

    const leadCounts = useMemo(() => {
        return leads.reduce<Record<LeadStatus, number>>(
            (counts, lead) => {
                counts[lead.status]++
                return counts
            },
            { new: 0, wrote: 0, replied: 0, posted: 0, rejected: 0 }
        )
    }, [leads])

    async function handleImport(event: React.FormEvent) {
        event.preventDefault()
        setMessage("")
        setImporting(true)

        try {
            const result = await importOlxLeads({
                searchUrl: searchUrl.trim(),
                audience,
                category,
                city: city.trim(),
                limit,
            })
            const data = result.data
            setMessage(`Найдено: ${data.found}. Добавлено: ${data.imported}. Дубликаты: ${data.duplicates}.`)
            await loadLeads()
        } catch (error) {
            console.error("[admin leads] OLX import failed", error)
            setMessage(getErrorMessage(error))
        } finally {
            setImporting(false)
        }
    }

    async function setLeadStatus(lead: Lead, status: LeadStatus) {
        if (lead.status === status) return
        await updateDoc(doc(db, "leads", lead.id), { status })
        setLeads(current => current.map(item => item.id === lead.id ? { ...item, status } : item))
    }

    async function copyLeadMessage(lead: Lead) {
        const text = buildLeadMessage(lead)

        try {
            await navigator.clipboard.writeText(text)
        } catch {
            const textarea = document.createElement("textarea")
            textarea.value = text
            textarea.style.position = "fixed"
            textarea.style.opacity = "0"
            document.body.appendChild(textarea)
            textarea.select()
            document.execCommand("copy")
            textarea.remove()
        }

        setCopiedLeadId(lead.id)
        window.setTimeout(() => setCopiedLeadId(current => current === lead.id ? null : current), 1800)
    }

    return (
        <div className="stack12">
            <div>
                <h2 className="h2">Lead Manager</h2>
                <div style={{ color: "#64748b", fontSize: 14 }}>
                    Ручная работа с публичными ссылками. Сообщения автоматически не отправляются.
                </div>
            </div>

            <section className="card stack12">
                <h3 className="h3">Импорт лидов с OLX</h3>
                <form onSubmit={handleImport} className="stack12">
                    <label className="stack8">
                        <span>OLX search URL</span>
                        <input
                            className="input"
                            type="url"
                            required
                            value={searchUrl}
                            onChange={event => setSearchUrl(event.target.value)}
                            placeholder="https://www.olx.pl/..."
                        />
                    </label>

                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                        gap: 12,
                    }}>
                        <label className="stack8">
                            <span>Аудитория</span>
                            <select className="select" value={audience} onChange={event => setAudience(event.target.value as LeadAudience)}>
                                <option value="pl">PL</option>
                                <option value="ua">UA</option>
                            </select>
                        </label>

                        <label className="stack8">
                            <span>Категория</span>
                            <select className="select" value={category} onChange={event => setCategory(event.target.value as LeadCategory)}>
                                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </label>

                        <label className="stack8">
                            <span>Город</span>
                            <input className="input" required value={city} onChange={event => setCity(event.target.value)} />
                        </label>

                        <label className="stack8">
                            <span>Лимит</span>
                            <input
                                className="input"
                                type="number"
                                min={1}
                                max={50}
                                required
                                value={limit}
                                onChange={event => setLimit(Number(event.target.value))}
                            />
                        </label>
                    </div>

                    <button className="btn-primary" type="submit" disabled={importing} style={{ width: "fit-content" }}>
                        {importing ? "Импорт..." : "Импортировать публичные ссылки"}
                    </button>
                </form>

                {message && <div style={{ fontSize: 14 }}>{message}</div>}
            </section>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(Object.keys(STATUS_LABELS) as LeadStatus[]).map(status => (
                    <span
                        key={status}
                        className="listing-badge"
                        style={{ background: "#eef2f7", color: "#334155" }}
                    >
                        {STATUS_LABELS[status]}: {leadCounts[status]}
                    </span>
                ))}
            </div>

            {loading && <div className="card">Загрузка лидов...</div>}
            {!loading && leads.length === 0 && <div className="card">Лидов пока нет.</div>}

            {!loading && leads.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1050 }}>
                        <thead>
                            <tr style={{ textAlign: "left", borderBottom: "1px solid #cbd5e1" }}>
                                <th style={cellStyle}>Лид</th>
                                <th style={cellStyle}>Аудитория</th>
                                <th style={cellStyle}>Категория</th>
                                <th style={cellStyle}>Город</th>
                                <th style={cellStyle}>Статус</th>
                                <th style={cellStyle}>Действия</th>
                            </tr>
                        </thead>
                        <tbody>
                            {leads.map(lead => (
                                <tr key={lead.id} style={{ borderBottom: "1px solid #e2e8f0", verticalAlign: "top" }}>
                                    <td style={cellStyle}>
                                        <div style={{ fontWeight: 700, maxWidth: 340 }}>{lead.title}</div>
                                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 5 }}>
                                            {new Date(lead.createdAt).toLocaleString()}
                                        </div>
                                    </td>
                                    <td style={cellStyle}>{lead.audience.toUpperCase()}</td>
                                    <td style={cellStyle}>{CATEGORY_LABELS[lead.category]}</td>
                                    <td style={cellStyle}>{lead.city}</td>
                                    <td style={cellStyle}>
                                        <span className="listing-badge" style={{ background: "#eef2f7", color: "#334155" }}>
                                            {STATUS_LABELS[lead.status]}
                                        </span>
                                    </td>
                                    <td style={cellStyle}>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxWidth: 520 }}>
                                            <a
                                                className="btn-secondary"
                                                href={lead.listingUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                Открыть объявление
                                            </a>
                                            <button className="btn-secondary" type="button" onClick={() => void copyLeadMessage(lead)}>
                                                {copiedLeadId === lead.id ? "Скопировано" : "Скопировать сообщение"}
                                            </button>
                                            {STATUS_ACTIONS.map(action => (
                                                <button
                                                    key={action.status}
                                                    className={lead.status === action.status ? "btn-primary" : "btn-secondary"}
                                                    type="button"
                                                    onClick={() => void setLeadStatus(lead, action.status)}
                                                >
                                                    {action.label}
                                                </button>
                                            ))}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

const cellStyle: React.CSSProperties = {
    padding: "10px 8px",
}

function buildLeadMessage(lead: Lead): string {
    if (lead.audience === "pl") {
        return `Dzień dobry! Zobaczyłem ogłoszenie „${lead.title}”. Zapraszamy również do bezpłatnego dodania ogłoszenia na Xoven.pl — lokalnej platformie ogłoszeń i aukcji w Polsce.`
    }

    return `Добрий день! Побачив оголошення «${lead.title}». Запрошуємо також безкоштовно розмістити оголошення на Xoven.pl — локальній платформі оголошень та аукціонів у Польщі.`
}

function getErrorMessage(error: unknown): string {
    if (error && typeof error === "object" && "message" in error) {
        const message = String((error as { message?: unknown }).message ?? "")
        if (message) return message
    }
    return "Не удалось импортировать ссылки OLX."
}

export default AdminLeadsPage
