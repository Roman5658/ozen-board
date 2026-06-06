import { useEffect, useMemo, useState } from "react"
import { collection, deleteDoc, doc, getDocs, orderBy, query, updateDoc } from "firebase/firestore"
import { createManualLead, importOlxLeads } from "../api/leads"
import { db } from "../app/firebase"
import type {
    Lead,
    LeadAudience,
    LeadCategory,
    LeadSource,
    LeadStatus,
} from "../types/lead"

type StatusFilter = "all" | LeadStatus
type SelectFilter<T extends string> = "all" | T

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

const SOURCE_LABELS: Record<LeadSource, string> = {
    olx: "OLX",
    allegro_lokalnie: "Allegro Lokalnie",
    otomoto: "Otomoto",
    facebook: "Facebook",
    other: "Other",
}

const CATEGORY_LABELS: Record<LeadCategory, string> = {
    jobs: "Работа",
    sales: "Продажи",
    services: "Услуги",
    rent: "Аренда",
    other: "Другое",
}

const SEARCH_PRESETS: Array<{
    id: string
    label: string
    source: LeadSource
    url: string
    category?: LeadCategory
    city?: string
}> = [
    { id: "olx-poland", label: "OLX cała Polska", source: "olx", url: "https://www.olx.pl/" },
    { id: "olx-jobs", label: "OLX praca", source: "olx", url: "https://www.olx.pl/praca/", category: "jobs" },
    { id: "olx-sales", label: "OLX sprzedaż", source: "olx", url: "https://www.olx.pl/oferty/", category: "sales" },
    { id: "olx-services", label: "OLX usługi", source: "olx", url: "https://www.olx.pl/uslugi/", category: "services" },
    { id: "olx-wroclaw", label: "OLX Wrocław", source: "olx", url: "https://www.olx.pl/wroclaw/", city: "Wrocław" },
    { id: "olx-warszawa", label: "OLX Warszawa", source: "olx", url: "https://www.olx.pl/warszawa/", city: "Warszawa" },
    { id: "olx-gdansk", label: "OLX Gdańsk", source: "olx", url: "https://www.olx.pl/gdansk/", city: "Gdańsk" },
    { id: "olx-torun", label: "OLX Toruń", source: "olx", url: "https://www.olx.pl/torun/", city: "Toruń" },
    { id: "olx-kalisz", label: "OLX Kalisz", source: "olx", url: "https://www.olx.pl/kalisz/", city: "Kalisz" },
    { id: "allegro", label: "Allegro Lokalnie", source: "allegro_lokalnie", url: "https://allegrolokalnie.pl/" },
    { id: "otomoto", label: "Otomoto", source: "otomoto", url: "https://www.otomoto.pl/" },
    { id: "facebook", label: "Facebook groups manual", source: "facebook", url: "https://www.facebook.com/groups/" },
]

const LEAD_SOURCES = Object.keys(SOURCE_LABELS) as LeadSource[]
const LEAD_CATEGORIES = Object.keys(CATEGORY_LABELS) as LeadCategory[]
const LEAD_STATUSES = Object.keys(STATUS_LABELS) as LeadStatus[]

function AdminLeadsPage() {
    const [leads, setLeads] = useState<Lead[]>([])
    const [loading, setLoading] = useState(true)
    const [importing, setImporting] = useState(false)
    const [savingManualLead, setSavingManualLead] = useState(false)
    const [busyLeadId, setBusyLeadId] = useState<string | null>(null)
    const [copiedLeadId, setCopiedLeadId] = useState<string | null>(null)
    const [message, setMessage] = useState("")
    const [manualMessage, setManualMessage] = useState("")

    const [source, setSource] = useState<LeadSource>("olx")
    const [selectedPreset, setSelectedPreset] = useState("")
    const [searchUrl, setSearchUrl] = useState("")
    const [audience, setAudience] = useState<LeadAudience>("pl")
    const [category, setCategory] = useState<LeadCategory>("other")
    const [city, setCity] = useState("")
    const [limit, setLimit] = useState(20)

    const [manualSource, setManualSource] = useState<LeadSource>("other")
    const [manualAudience, setManualAudience] = useState<LeadAudience>("pl")
    const [manualLanguage, setManualLanguage] = useState<LeadAudience>("pl")
    const [manualCategory, setManualCategory] = useState<LeadCategory>("other")
    const [manualCity, setManualCity] = useState("")
    const [manualTitle, setManualTitle] = useState("")
    const [manualListingUrl, setManualListingUrl] = useState("")
    const [manualContactUrl, setManualContactUrl] = useState("")
    const [manualNote, setManualNote] = useState("")

    const [sourceFilter, setSourceFilter] = useState<SelectFilter<LeadSource>>("all")
    const [audienceFilter, setAudienceFilter] = useState<SelectFilter<LeadAudience>>("all")
    const [categoryFilter, setCategoryFilter] = useState<SelectFilter<LeadCategory>>("all")
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
    const [cityFilter, setCityFilter] = useState("all")
    const [searchFilter, setSearchFilter] = useState("")

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

    const cityOptions = useMemo(
        () => Array.from(new Set(leads.map(lead => lead.city?.trim()).filter(Boolean) as string[]))
            .sort((a, b) => a.localeCompare(b)),
        [leads]
    )

    const filteredLeads = useMemo(() => {
        const search = searchFilter.trim().toLowerCase()
        return leads.filter(lead => {
            const leadSource = lead.source ?? "olx"
            const leadCity = lead.city?.trim() ?? ""
            return (sourceFilter === "all" || leadSource === sourceFilter) &&
                (audienceFilter === "all" || lead.audience === audienceFilter) &&
                (categoryFilter === "all" || lead.category === categoryFilter) &&
                (statusFilter === "all" || lead.status === statusFilter) &&
                (cityFilter === "all" || (cityFilter === "__all_poland__" ? !leadCity : leadCity === cityFilter)) &&
                (!search || `${lead.title} ${lead.listingUrl} ${lead.contactUrl}`.toLowerCase().includes(search))
        })
    }, [
        leads,
        audienceFilter,
        categoryFilter,
        cityFilter,
        searchFilter,
        sourceFilter,
        statusFilter,
    ])

    function applyPreset(presetId: string) {
        setSelectedPreset(presetId)
        const preset = SEARCH_PRESETS.find(item => item.id === presetId)
        if (!preset) return

        setSource(preset.source)
        setSearchUrl(preset.url)
        if (preset.category) setCategory(preset.category)
        setCity(preset.city ?? "")
        setMessage(preset.source === "olx"
            ? ""
            : "Для этого источника автоматический импорт пока не реализован. Добавьте ссылку вручную ниже.")
    }

    async function handleImport(event: React.FormEvent) {
        event.preventDefault()
        setMessage("")

        if (source !== "olx") {
            setMessage(`${SOURCE_LABELS[source]}: автоматический импорт пока не реализован. Используйте ручное добавление лида.`)
            return
        }

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

    async function handleManualCreate(event: React.FormEvent) {
        event.preventDefault()
        setManualMessage("")
        setSavingManualLead(true)

        try {
            const result = await createManualLead({
                source: manualSource,
                audience: manualAudience,
                language: manualLanguage,
                category: manualCategory,
                city: manualCity.trim(),
                title: manualTitle.trim(),
                listingUrl: manualListingUrl.trim(),
                contactUrl: manualContactUrl.trim(),
                note: manualNote.trim(),
            })

            if (result.data.duplicate) {
                setManualMessage("Лид с такой ссылкой уже существует.")
                return
            }

            setManualMessage("Лид добавлен.")
            setManualCity("")
            setManualTitle("")
            setManualListingUrl("")
            setManualContactUrl("")
            setManualNote("")
            await loadLeads()
        } catch (error) {
            console.error("[admin leads] manual lead create failed", error)
            setManualMessage(getErrorMessage(error))
        } finally {
            setSavingManualLead(false)
        }
    }

    async function setLeadStatus(lead: Lead, status: LeadStatus) {
        if (lead.status === status || busyLeadId === lead.id) return
        setBusyLeadId(lead.id)
        try {
            await updateDoc(doc(db, "leads", lead.id), { status })
            setLeads(current => current.map(item => item.id === lead.id ? { ...item, status } : item))
        } catch (error) {
            console.error("[admin leads] status update failed", error)
            window.alert("Не удалось сохранить статус лида.")
        } finally {
            setBusyLeadId(null)
        }
    }

    async function removeLead(lead: Lead) {
        if (busyLeadId === lead.id) return
        const confirmed = window.confirm(`Удалить лид «${lead.title}»? Это действие нельзя отменить.`)
        if (!confirmed) return

        setBusyLeadId(lead.id)
        try {
            await deleteDoc(doc(db, "leads", lead.id))
            setLeads(current => current.filter(item => item.id !== lead.id))
        } catch (error) {
            console.error("[admin leads] lead delete failed", error)
            window.alert("Не удалось удалить лид.")
        } finally {
            setBusyLeadId(null)
        }
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

    function renderLeadActions(lead: Lead) {
        const isBusy = busyLeadId === lead.id
        return (
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
                        disabled={isBusy}
                        onClick={() => void setLeadStatus(lead, action.status)}
                    >
                        {action.label}
                    </button>
                ))}
                <button
                    className="btn-danger admin-lead-action"
                    type="button"
                    disabled={isBusy}
                    onClick={() => void removeLead(lead)}
                >
                    Удалить
                </button>
            </div>
        )
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
                <h3 className="admin-leads-import__title">Импорт лидов</h3>
                <form onSubmit={handleImport} className="admin-leads-form">
                    <div className="admin-leads-form__grid admin-leads-form__grid--import">
                        <label className="admin-leads-field">
                            <span>Source</span>
                            <select className="select" value={source} onChange={event => {
                                setSource(event.target.value as LeadSource)
                                setSelectedPreset("")
                                setMessage("")
                            }}>
                                {LEAD_SOURCES.map(value => (
                                    <option key={value} value={value}>{SOURCE_LABELS[value]}</option>
                                ))}
                            </select>
                        </label>

                        <label className="admin-leads-field admin-leads-field--preset">
                            <span>Готовые ссылки</span>
                            <select className="select" value={selectedPreset} onChange={event => applyPreset(event.target.value)}>
                                <option value="">Выберите пресет</option>
                                {SEARCH_PRESETS.map(preset => (
                                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                                ))}
                            </select>
                        </label>

                        <label className="admin-leads-field admin-leads-field--url">
                            <span>Search URL</span>
                            <input
                                className="input"
                                type="url"
                                required
                                value={searchUrl}
                                onChange={event => {
                                    setSearchUrl(event.target.value)
                                    setSelectedPreset("")
                                }}
                                placeholder="https://..."
                            />
                        </label>
                    </div>

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
                                {LEAD_CATEGORIES.map(value => (
                                    <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>
                                ))}
                            </select>
                        </label>

                        <label className="admin-leads-field">
                            <span>Город (необязательно)</span>
                            <input
                                className="input"
                                value={city}
                                onChange={event => setCity(event.target.value)}
                                placeholder="Пусто = Вся Польша"
                            />
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
                        {importing ? "Импорт..." : source === "olx" ? "Импортировать публичные ссылки" : "Проверить доступность импорта"}
                    </button>
                </form>

                {source !== "olx" && (
                    <div className="admin-leads-notice">
                        Автоматический импорт для {SOURCE_LABELS[source]} пока не реализован. Без логина и парсинга приватных страниц используйте ручное добавление.
                    </div>
                )}
                {message && <div className="admin-leads-message">{message}</div>}
            </section>

            <details className="card admin-leads-manual">
                <summary>Добавить лид вручную</summary>
                <form onSubmit={handleManualCreate} className="admin-leads-form admin-leads-manual__form">
                    <div className="admin-leads-form__grid">
                        <label className="admin-leads-field">
                            <span>Source</span>
                            <select className="select" value={manualSource} onChange={event => setManualSource(event.target.value as LeadSource)}>
                                {LEAD_SOURCES.map(value => (
                                    <option key={value} value={value}>{SOURCE_LABELS[value]}</option>
                                ))}
                            </select>
                        </label>
                        <label className="admin-leads-field">
                            <span>Аудитория</span>
                            <select className="select" value={manualAudience} onChange={event => setManualAudience(event.target.value as LeadAudience)}>
                                <option value="pl">PL</option>
                                <option value="ua">UA</option>
                            </select>
                        </label>
                        <label className="admin-leads-field">
                            <span>Язык</span>
                            <select className="select" value={manualLanguage} onChange={event => setManualLanguage(event.target.value as LeadAudience)}>
                                <option value="pl">PL</option>
                                <option value="ua">UA</option>
                            </select>
                        </label>
                        <label className="admin-leads-field">
                            <span>Категория</span>
                            <select className="select" value={manualCategory} onChange={event => setManualCategory(event.target.value as LeadCategory)}>
                                {LEAD_CATEGORIES.map(value => (
                                    <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>
                                ))}
                            </select>
                        </label>
                        <label className="admin-leads-field">
                            <span>Город (необязательно)</span>
                            <input className="input" value={manualCity} onChange={event => setManualCity(event.target.value)} />
                        </label>
                        <label className="admin-leads-field admin-leads-field--wide">
                            <span>Название</span>
                            <input className="input" required maxLength={250} value={manualTitle} onChange={event => setManualTitle(event.target.value)} />
                        </label>
                        <label className="admin-leads-field admin-leads-field--wide">
                            <span>Listing URL</span>
                            <input className="input" type="url" required value={manualListingUrl} onChange={event => setManualListingUrl(event.target.value)} />
                        </label>
                        <label className="admin-leads-field admin-leads-field--wide">
                            <span>Contact URL (необязательно)</span>
                            <input
                                className="input"
                                type="url"
                                value={manualContactUrl}
                                onChange={event => setManualContactUrl(event.target.value)}
                                placeholder="По умолчанию Listing URL"
                            />
                        </label>
                        <label className="admin-leads-field admin-leads-field--full">
                            <span>Заметка</span>
                            <textarea className="input admin-leads-note" maxLength={2000} value={manualNote} onChange={event => setManualNote(event.target.value)} />
                        </label>
                    </div>
                    <button className="btn-primary admin-leads-import__button" type="submit" disabled={savingManualLead}>
                        {savingManualLead ? "Сохранение..." : "Добавить лид"}
                    </button>
                    {manualMessage && <div className="admin-leads-message">{manualMessage}</div>}
                </form>
            </details>

            <div className="admin-leads-summary" aria-label="Фильтр по статусу">
                <button
                    className={`admin-lead-counter ${statusFilter === "all" ? "active" : ""}`}
                    type="button"
                    onClick={() => setStatusFilter("all")}
                >
                    Все: {leads.length}
                </button>
                {LEAD_STATUSES.map(status => (
                    <button
                        key={status}
                        className={`admin-lead-counter ${statusFilter === status ? "active" : ""}`}
                        type="button"
                        onClick={() => setStatusFilter(status)}
                    >
                        {STATUS_LABELS[status]}: {leadCounts[status]}
                    </button>
                ))}
            </div>

            <section className="card admin-leads-filters">
                <div className="admin-leads-filters__grid">
                    <label className="admin-leads-field">
                        <span>Источник</span>
                        <select className="select" value={sourceFilter} onChange={event => setSourceFilter(event.target.value as SelectFilter<LeadSource>)}>
                            <option value="all">Все</option>
                            {LEAD_SOURCES.map(value => <option key={value} value={value}>{SOURCE_LABELS[value]}</option>)}
                        </select>
                    </label>
                    <label className="admin-leads-field">
                        <span>Аудитория</span>
                        <select className="select" value={audienceFilter} onChange={event => setAudienceFilter(event.target.value as SelectFilter<LeadAudience>)}>
                            <option value="all">Все</option>
                            <option value="pl">PL</option>
                            <option value="ua">UA</option>
                        </select>
                    </label>
                    <label className="admin-leads-field">
                        <span>Категория</span>
                        <select className="select" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value as SelectFilter<LeadCategory>)}>
                            <option value="all">Все</option>
                            {LEAD_CATEGORIES.map(value => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}
                        </select>
                    </label>
                    <label className="admin-leads-field">
                        <span>Статус</span>
                        <select className="select" value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)}>
                            <option value="all">Все</option>
                            {LEAD_STATUSES.map(value => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
                        </select>
                    </label>
                    <label className="admin-leads-field">
                        <span>Город</span>
                        <select className="select" value={cityFilter} onChange={event => setCityFilter(event.target.value)}>
                            <option value="all">Все</option>
                            <option value="__all_poland__">Вся Польша</option>
                            {cityOptions.map(value => <option key={value} value={value}>{value}</option>)}
                        </select>
                    </label>
                    <label className="admin-leads-field admin-leads-field--search">
                        <span>Поиск по названию или URL</span>
                        <input className="input" value={searchFilter} onChange={event => setSearchFilter(event.target.value)} placeholder="Название или ссылка" />
                    </label>
                </div>
            </section>

            {loading && <div className="card">Загрузка лидов...</div>}
            {!loading && leads.length === 0 && <div className="card">Лидов пока нет.</div>}
            {!loading && leads.length > 0 && filteredLeads.length === 0 && (
                <div className="card">По выбранным фильтрам лидов нет.</div>
            )}

            {!loading && filteredLeads.length > 0 && (
                <>
                    <div className="admin-leads-results">
                        Показано: {filteredLeads.length} из {leads.length}
                    </div>
                    <div className="admin-leads-table-wrap">
                        <table className="admin-leads-table">
                            <thead>
                                <tr>
                                    <th>Лид</th>
                                    <th>Источник</th>
                                    <th>Аудитория</th>
                                    <th>Категория</th>
                                    <th>Город</th>
                                    <th>Статус</th>
                                    <th>Действия</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredLeads.map(lead => (
                                    <tr key={lead.id}>
                                        <td>
                                            <div className="admin-lead-title">{lead.title}</div>
                                            <div className="admin-lead-date">
                                                {new Date(lead.createdAt).toLocaleString()}
                                            </div>
                                        </td>
                                        <td>{SOURCE_LABELS[lead.source ?? "olx"]}</td>
                                        <td>{lead.audience.toUpperCase()}</td>
                                        <td>{CATEGORY_LABELS[lead.category]}</td>
                                        <td>{formatLeadCity(lead.city)}</td>
                                        <td>
                                            <span className={`listing-badge admin-lead-status admin-lead-status--${lead.status}`}>
                                                {STATUS_LABELS[lead.status]}
                                            </span>
                                        </td>
                                        <td>{renderLeadActions(lead)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="admin-leads-cards">
                        {filteredLeads.map(lead => (
                            <article className="card admin-lead-card" key={lead.id}>
                                <div className="admin-lead-card__header">
                                    <div className="admin-lead-title">{lead.title}</div>
                                    <span className={`listing-badge admin-lead-status admin-lead-status--${lead.status}`}>
                                        {STATUS_LABELS[lead.status]}
                                    </span>
                                </div>
                                <div className="admin-lead-card__meta">
                                    <span>{SOURCE_LABELS[lead.source ?? "olx"]}</span>
                                    <span>{lead.audience.toUpperCase()}</span>
                                    <span>{CATEGORY_LABELS[lead.category]}</span>
                                    <span>{formatLeadCity(lead.city)}</span>
                                </div>
                                <div className="admin-lead-date">
                                    {new Date(lead.createdAt).toLocaleString()}
                                </div>
                                {renderLeadActions(lead)}
                            </article>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}

function formatLeadCity(city?: string): string {
    return city?.trim() || "Вся Польша"
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
    return "Не удалось выполнить действие."
}

export default AdminLeadsPage
