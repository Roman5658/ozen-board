import { useCallback, useEffect, useState } from "react"
import {
    getTelegramListingsForModeration,
    moderateTelegramListing,
    type TelegramModerationCandidate,
    type TelegramModerationItem,
} from "../api/telegramListingsAdmin"
import { getLocalUser } from "../data/localUser"
import { requireMatchingFirebaseUser } from "../data/authGuard"
import { detectInitialLang } from "../app/i18n"
import { CATALOG_CATEGORIES } from "../data/catalogCategories"

const CATEGORY_OPTIONS = ["work", "sell", "buy", "service", "rent"] as const
const CATALOG_OPTIONS = ["", "animals", "electronics", "furniture", "clothing", "construction", "transport", "garden", "children", "other"] as const

const REASON_LABELS: Record<string, { uk: string; pl: string }> = {
    auto_publish_disabled: { uk: "Автоматична публікація вимкнена", pl: "Automatyczna publikacja jest wyłączona" },
    sender_unverified: { uk: "Не вдалося перевірити автора каналу", pl: "Nie udało się zweryfikować autora kanału" },
    missing_text: { uk: "Немає тексту оголошення", pl: "Brak tekstu ogłoszenia" },
    missing_or_short_title: { uk: "Потрібно уточнити заголовок", pl: "Uzupełnij tytuł" },
    missing_or_short_description: { uk: "Потрібно уточнити опис", pl: "Uzupełnij opis" },
    title_too_long: { uk: "Заголовок задовгий", pl: "Tytuł jest za długi" },
    description_too_long: { uk: "Опис задовгий", pl: "Opis jest za długi" },
    external_link_requires_review: { uk: "У тексті є зовнішнє посилання", pl: "Tekst zawiera zewnętrzny link" },
    spam_signal_requires_review: { uk: "Є ознаки рекламного або ризикового повідомлення", pl: "Wiadomość może być reklamowa lub ryzykowna" },
    media_group_requires_review: { uk: "Фотоальбом перевіряється окремими повідомленнями", pl: "Album zdjęć wymaga osobnej weryfikacji" },
    category_not_authorized: { uk: "Категорію не дозволено переносити", pl: "Brak zgody na przeniesienie kategorii" },
    category_missing: { uk: "Не вказана категорія", pl: "Nie podano kategorii" },
    category_unmapped: { uk: "Категорію не зіставлено з каталогом", pl: "Kategoria nie jest przypisana do katalogu" },
    price_not_authorized: { uk: "Ціну не дозволено переносити", pl: "Brak zgody na przeniesienie ceny" },
    price_invalid_or_currency_unknown: { uk: "Невідома ціна або валюта", pl: "Nieznana cena lub waluta" },
    offer_type_unknown: { uk: "Не вдалося визначити тип пропозиції", pl: "Nie udało się ustalić typu oferty" },
    paid_price_missing: { uk: "Для платного оголошення потрібна ціна", pl: "Płatne ogłoszenie wymaga ceny" },
    offer_price_conflict: { uk: "Тип пропозиції суперечить ціні", pl: "Typ oferty jest sprzeczny z ceną" },
    location_not_authorized: { uk: "Місце не дозволено переносити", pl: "Brak zgody na przeniesienie lokalizacji" },
    city_missing: { uk: "Не вказане місто", pl: "Nie podano miasta" },
    voivodeship_missing: { uk: "Не вказане воєводство", pl: "Nie podano województwa" },
    contact_not_authorized: { uk: "Контакт не дозволено переносити", pl: "Brak zgody na przeniesienie kontaktu" },
    contact_ambiguous: { uk: "Контакт потрібно перевірити", pl: "Dane kontaktowe wymagają sprawdzenia" },
    images_not_authorized: { uk: "Фото не дозволено переносити", pl: "Brak zgody na przeniesienie zdjęć" },
    description_not_authorized: { uk: "Опис не дозволено переносити", pl: "Brak zgody na przeniesienie opisu" },
    required_fields_not_authorized: { uk: "Не підтверджено перенесення обов’язкових полів", pl: "Nie potwierdzono przeniesienia wymaganych pól" },
    unrecognized_metadata: { uk: "Є нерозпізнані поля", pl: "Wykryto nierozpoznane pola" },
    ad_validation_failed: { uk: "Перевірте обов’язкові поля оголошення", pl: "Sprawdź wymagane pola ogłoszenia" },
    daily_import_limit_reached: { uk: "Досягнуто денний ліміт імпорту", pl: "Osiągnięto dzienny limit importu" },
    edited_after_publish: { uk: "Джерело змінило опубліковане повідомлення", pl: "Źródłowa wiadomość została zmieniona" },
    photo_not_supported: { uk: "Формат або розмір фото не підтримується", pl: "Format lub rozmiar zdjęcia jest nieobsługiwany" },
    manual_review_required: { uk: "Потрібна ручна перевірка", pl: "Wymagana jest ręczna weryfikacja" },
}

function updateCandidate(item: TelegramModerationItem, patch: Partial<TelegramModerationCandidate>): TelegramModerationItem {
    return { ...item, candidate: { ...item.candidate, ...patch } }
}

export default function AdminTelegramModerationPage() {
    const lang = detectInitialLang()
    const isPolish = lang === "pl"
    const [items, setItems] = useState<TelegramModerationItem[]>([])
    const [loading, setLoading] = useState(true)
    const [busyId, setBusyId] = useState("")
    const [error, setError] = useState("")
    const [notice, setNotice] = useState("")
    const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({})

    const loadItems = useCallback(async () => {
        setLoading(true)
        setError("")
        try {
            await requireMatchingFirebaseUser(getLocalUser())
            setItems(await getTelegramListingsForModeration())
        } catch {
            setError(isPolish ? "Nie udało się pobrać kolejki. Sprawdź konto administratora." : "Не вдалося завантажити чергу. Перевірте обліковий запис адміністратора.")
        } finally {
            setLoading(false)
        }
    }, [isPolish])

    useEffect(() => { void loadItems() }, [loadItems])

    async function act(item: TelegramModerationItem, action: "approve" | "reject") {
        setBusyId(item.id)
        setError("")
        setNotice("")
        try {
            await requireMatchingFirebaseUser(getLocalUser())
            await moderateTelegramListing({
                id: item.id,
                expectedContentHash: item.expectedContentHash,
                action,
                ...(action === "approve" ? {
                    ad: {
                        title: item.candidate.title,
                        description: item.candidate.description,
                        category: item.candidate.category,
                        catalogCategory: item.candidate.catalogCategory,
                        catalogSubcategory: item.candidate.catalogSubcategory,
                        city: item.candidate.city,
                        voivodeship: item.candidate.voivodeship,
                        priceType: item.candidate.priceType,
                        price: item.candidate.price,
                        exchangeDetails: item.candidate.exchangeDetails,
                        sellerContact: item.candidate.sellerContact,
                    },
                } : { reason: rejectionReasons[item.id] ?? "" }),
            })
            setNotice(action === "approve"
                ? (isPolish ? "Ogłoszenie zostało opublikowane." : "Оголошення опубліковано.")
                : (isPolish ? "Import został odrzucony." : "Імпорт відхилено."))
            await loadItems()
        } catch (actionError) {
            setError(actionError instanceof Error && actionError.message
                ? actionError.message
                : (isPolish ? "Nie udało się wykonać operacji." : "Не вдалося виконати дію."))
        } finally {
            setBusyId("")
        }
    }

    function field(item: TelegramModerationItem, key: keyof TelegramModerationCandidate, label: string, multiline = false) {
        const value = item.candidate[key]
        const control = multiline
            ? <textarea value={String(value)} onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? updateCandidate(entry, { [key]: event.target.value }) : entry))} />
            : <input value={String(value)} onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? updateCandidate(entry, { [key]: event.target.value }) : entry))} />
        return <label className="telegram-moderation__field" key={key}>{label}{control}</label>
    }

    return (
        <section className="telegram-moderation" aria-labelledby="telegram-moderation-title">
            <header className="telegram-moderation__header">
                <div>
                    <h1 id="telegram-moderation-title">{isPolish ? "Moderacja importów Telegram" : "Модерація імпорту Telegram"}</h1>
                    <p>{isPolish ? "Osobna kolejka dla importów Telegram. Nie jest połączona z kolejką TOP." : "Окрема черга імпорту Telegram, не пов’язана з чергою TOP."}</p>
                </div>
                <button type="button" onClick={() => void loadItems()} disabled={loading || !!busyId}>{isPolish ? "Odśwież" : "Оновити"}</button>
            </header>
            {error && <p className="telegram-moderation__alert" role="alert">{error}</p>}
            {notice && <p className="telegram-moderation__notice" role="status">{notice}</p>}
            {loading ? <p>{isPolish ? "Ładowanie…" : "Завантаження…"}</p> : items.length === 0 ? (
                <div className="telegram-moderation__empty">{isPolish ? "Nie ma importów do sprawdzenia." : "Немає імпортів для перевірки."}</div>
            ) : items.map((item) => (
                <article className="telegram-moderation__item" key={item.id}>
                    <header>
                        <div>
                            <strong>{item.isPublishedEdit
                                ? (isPolish ? "Zmiana opublikowanego ogłoszenia" : "Зміна опублікованого оголошення")
                                : (isPolish ? "Nowy import" : "Новий імпорт")}</strong>
                            <small>{new Date(item.receivedAt).toLocaleString(isPolish ? "pl-PL" : "uk-UA")}</small>
                        </div>
                        {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{isPolish ? "Oryginalna wiadomość" : "Оригінальне повідомлення"}</a>}
                    </header>
                    {item.reviewReasons.length > 0 && <ul className="telegram-moderation__reasons">{item.reviewReasons.map((reason) => <li key={reason}>{REASON_LABELS[reason]?.[isPolish ? "pl" : "uk"] ?? reason}</li>)}</ul>}
                    <div className="telegram-moderation__grid">
                        {field(item, "title", isPolish ? "Tytuł" : "Заголовок")}
                        <label className="telegram-moderation__field">{isPolish ? "Kategoria" : "Категорія"}
                            <select value={item.candidate.category} onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? updateCandidate(entry, { category: event.target.value }) : entry))}>
                                <option value="">{isPolish ? "Wybierz kategorię" : "Оберіть категорію"}</option>
                                {CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{category}</option>)}
                            </select>
                        </label>
                        <label className="telegram-moderation__field">{isPolish ? "Kategoria katalogu" : "Категорія каталогу"}
                            <select value={item.candidate.catalogCategory} onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? updateCandidate(entry, { catalogCategory: event.target.value, catalogSubcategory: "" }) : entry))}>
                                {CATALOG_OPTIONS.map((category) => <option key={category} value={category}>{category || (isPolish ? "Brak" : "Немає")}</option>)}
                            </select>
                        </label>
                        <label className="telegram-moderation__field">{isPolish ? "Podkategoria" : "Підкатегорія"}
                            <select value={item.candidate.catalogSubcategory} onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? updateCandidate(entry, { catalogSubcategory: event.target.value }) : entry))}>
                                <option value="">{isPolish ? "Brak" : "Немає"}</option>
                                {(CATALOG_CATEGORIES[item.candidate.catalogCategory as keyof typeof CATALOG_CATEGORIES] ?? []).map((subcategory) => <option key={subcategory} value={subcategory}>{subcategory}</option>)}
                            </select>
                        </label>
                        {field(item, "city", isPolish ? "Miasto" : "Місто")}
                        {field(item, "voivodeship", isPolish ? "Województwo" : "Воєводство")}
                        <label className="telegram-moderation__field">{isPolish ? "Typ oferty" : "Тип пропозиції"}
                            <select value={item.candidate.priceType} onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? updateCandidate(entry, { priceType: event.target.value, price: event.target.value === "paid" ? entry.candidate.price : "" }) : entry))}>
                                <option value="">{isPolish ? "Wybierz" : "Оберіть"}</option>
                                <option value="paid">{isPolish ? "Płatne" : "Платно"}</option>
                                <option value="free">{isPolish ? "Bezpłatne" : "Безкоштовно"}</option>
                                <option value="exchange">{isPolish ? "Wymiana" : "Обмін"}</option>
                            </select>
                        </label>
                        {item.candidate.priceType === "paid" && field(item, "price", isPolish ? "Cena" : "Ціна")}
                        {item.candidate.priceType === "exchange" && field(item, "exchangeDetails", isPolish ? "Na co wymiana?" : "На що обмін?")}
                        {field(item, "sellerContact", isPolish ? "Kontakt" : "Контакт")}
                        {field(item, "description", isPolish ? "Opis" : "Опис", true)}
                    </div>
                    {item.candidate.images.length > 0 && <div className="telegram-moderation__images">{item.candidate.images.map((image) => <img key={image} src={image} alt="Telegram import" />)}</div>}
                    <label className="telegram-moderation__field">{isPolish ? "Powód odrzucenia (opcjonalnie)" : "Причина відхилення (необов’язково)"}
                        <input value={rejectionReasons[item.id] ?? ""} maxLength={240} onChange={(event) => setRejectionReasons((current) => ({ ...current, [item.id]: event.target.value }))} />
                    </label>
                    <footer>
                        <button type="button" className="btn-primary" onClick={() => void act(item, "approve")} disabled={!!busyId}>{busyId === item.id ? (isPolish ? "Zapisywanie…" : "Збереження…") : (isPolish ? "Zatwierdź i opublikuj" : "Схвалити й опублікувати")}</button>
                        <button type="button" className="btn-danger" onClick={() => void act(item, "reject")} disabled={!!busyId}>{isPolish ? "Odrzuć" : "Відхилити"}</button>
                    </footer>
                </article>
            ))}
        </section>
    )
}
