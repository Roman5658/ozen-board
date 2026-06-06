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
        <div className="admin-leads-page stack12">
            <div className="admin-leads-header">
                <h2 className="h2">Lead Manager</h2>
                <div className="admin-leads-subtitle">
                    Ручная работа с публичными ссылками. Сообщения автоматически не отправляются.
                </div>
            </div>

            <section className="card admin-leads-import">
                <h3 className="admin-leads-import__title">Импорт лидов с OLX</h3>
                <form onSubmit={handleImport} className="admin-leads-form">
                    <label className="admin-leads-field admin-leads-field--url">
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

                    <div className="admin-leads-form__grid">
                        <label className="admin-leads-field">
                            <span>Аудитория</span>
                            <select className="select" value={audience} onChange={event => setAudience(event.target.value as LeadAudience)}>
                                <option value="pl">PL</option>
                                <option value="ua">UA</option>
                            </select>
                        </label>

                        <label className="admin-leads-field">
                            <span>Категория</span>
                            <select className="select" value={category} onChange={event => setCategory(event.target.value as LeadCategory)}>
                                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </label>

                        <label className="admin-leads-field">
                            <span>Город</span>
                            <input className="input" required value={city} onChange={event => setCity(event.target.value)} />
                        </label>

                        <label className="admin-leads-field">
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

                    <button className="btn-primary admin-leads-import__button" type="submit" disabled={importing}>
                        {importing ? "Импорт..." : "Импортировать публичные ссылки"}
                    </button>
                </form>

                {message && <div className="admin-leads-message">{message}</div>}
            </section>

            <div className="admin-leads-summary">
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
                <>
                <div className="admin-leads-table-wrap">
                    <table className="admin-leads-table">
                        <thead>
                            <tr>
                                <th>Лид</th>
                                <th>Аудитория</th>
                                <th>Категория</th>
                                <th>Город</th>
                                <th>Статус</th>
                                <th>Действия</th>
                            </tr>
                        </thead>
                        <tbody>
                            {leads.map(lead => (
                                <tr key={lead.id}>
                                    <td>
                                        <div className="admin-lead-title">{lead.title}</div>
                                        <div className="admin-lead-date">
                                            {new Date(lead.createdAt).toLocaleString()}
                                        </div>
                                    </td>
                                    <td>{lead.audience.toUpperCase()}</td>
                                    <td>{CATEGORY_LABELS[lead.category]}</td>
                                    <td>{lead.city}</td>
                                    <td>
                                        <span className="listing-badge" style={{ background: "#eef2f7", color: "#334155" }}>
                                            {STATUS_LABELS[lead.status]}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="admin-lead-actions">
                                            <a
                                                className="btn-secondary admin-lead-action"
                                                href={lead.listingUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                Открыть
                                            </a>
                                            <button className="btn-secondary admin-lead-action" type="button" onClick={() => void copyLeadMessage(lead)}>
                                                {copiedLeadId === lead.id ? "Скопировано" : "Копировать"}
                                            </button>
                                            {STATUS_ACTIONS.map(action => (
                                                <button
                                                    key={action.status}
                                                    className={`${lead.status === action.status ? "btn-primary" : "btn-secondary"} admin-lead-action`}
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
                <div className="admin-leads-cards">
                    {leads.map(lead => (
                        <article className="card admin-lead-card" key={lead.id}>
                            <div className="admin-lead-card__header">
                                <div className="admin-lead-title">{lead.title}</div>
                                <span className="listing-badge" style={{ background: "#eef2f7", color: "#334155" }}>
                                    {STATUS_LABELS[lead.status]}
                                </span>
                            </div>
                            <div className="admin-lead-card__meta">
                                <span>{lead.audience.toUpperCase()}</span>
                                <span>{CATEGORY_LABELS[lead.category]}</span>
                                <span>{lead.city}</span>
                            </div>
                            <div className="admin-lead-date">
                                {new Date(lead.createdAt).toLocaleString()}
                            </div>
                            <div className="admin-lead-actions">
                                <a
                                    className="btn-secondary admin-lead-action"
                                    href={lead.listingUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    Открыть
                                </a>
                                <button className="btn-secondary admin-lead-action" type="button" onClick={() => void copyLeadMessage(lead)}>
                                    {copiedLeadId === lead.id ? "Скопировано" : "Копировать"}
                                </button>
                                {STATUS_ACTIONS.map(action => (
                                    <button
                                        key={action.status}
                                        className={`${lead.status === action.status ? "btn-primary" : "btn-secondary"} admin-lead-action`}
                                        type="button"
                                        onClick={() => void setLeadStatus(lead, action.status)}
                                    >
                                        {action.label}
                                    </button>
                                ))}
                            </div>
                        </article>
                    ))}
                </div>
                </>
            )}
        </div>
    )
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
