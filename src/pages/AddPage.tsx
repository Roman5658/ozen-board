import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_LANG, type Lang } from "../app/i18n";
import { CITIES_BY_VOIVODESHIP } from "../data/cities";
import { addLocalAd } from "../data/localAds";

import { getLocalUser } from "../data/localUser"
import { addLocalAuction } from "../data/localAuctions"
import { useEffect } from "react";




import styles from "./AddPage.module.css";
type VoivodeshipKey = keyof typeof CITIES_BY_VOIVODESHIP;

type AddMode = "ad" | "auction";
type Category = 'work' | 'sell' | 'buy' | 'service' | 'rent'
type AddFormState = {
    mode: AddMode;
    title: string;
    description: string;
    category: Category | "";

    voivodeship: string;
    city: string;

    // обычное объявление
    priceText: string;

    // аукцион
    startPriceText: string;
    buyNowPriceText: string;
    endsAt: string; // input type datetime-local (string)
    images: string[]; // пока mock: ссылки/плейсхолдеры, без реальной загрузки
};



const CATEGORIES = [
    { value: "work", ua: "Робота", pl: "Praca" },
    { value: "sell", ua: "Продаж", pl: "Sprzedaż" },
    { value: "buy", ua: "Куплю", pl: "Kupię" },
    { value: "service", ua: "Послуги", pl: "Usługi" },
    { value: "rent", ua: "Оренда", pl: "Wynajem" },
];

const VOIVODESHIPS = [
    { value: "all", ua: "Вся Польща", pl: "Cała Polska" },
    { value: "dolnoslaskie", ua: "Нижньосілезьке", pl: "Dolnośląskie" },
    { value: "kujawskoPomorskie", ua: "Куявсько-Поморське", pl: "Kujawsko-Pomorskie" },
    { value: "lubelskie", ua: "Люблінське", pl: "Lubelskie" },
    { value: "lubuskie", ua: "Любуське", pl: "Lubuskie" },
    { value: "lodzkie", ua: "Лодзьке", pl: "Łódzkie" },
    { value: "malopolskie", ua: "Малопольське", pl: "Małopolskie" },
    { value: "mazowieckie", ua: "Мазовецьке", pl: "Mazowieckie" },
    { value: "opolskie", ua: "Опольське", pl: "Opolskie" },
    { value: "podkarpackie", ua: "Підкарпатське", pl: "Podkarpackie" },
    { value: "podlaskie", ua: "Підляське", pl: "Podlaskie" },
    { value: "pomorskie", ua: "Поморське", pl: "Pomorskie" },
    { value: "slaskie", ua: "Сілезьке", pl: "Śląskie" },
    { value: "swietokrzyskie", ua: "Свентокшиське", pl: "Świętokrzyskie" },
    { value: "warminskoMazurskie", ua: "Вармінсько-Мазурське", pl: "Warmińsko-Mazurskie" },
    { value: "wielkopolskie", ua: "Великопольське", pl: "Wielkopolskie" },
    { value: "zachodniopomorskie", ua: "Західнопоморське", pl: "Zachodniopomorskie" },
];


export default function AddPage() {
    const nav = useNavigate()
    const lang = (localStorage.getItem("lang") as Lang) || DEFAULT_LANG
    const user = getLocalUser()

    // ✅ ВСЕ ХУКИ — СРАЗУ
    const [form, setForm] = useState<AddFormState>({
        mode: "ad",
        title: "",
        description: "",
        category: "",
        voivodeship: "",
        city: "",
        priceText: "",
        startPriceText: "",
        buyNowPriceText: "",
        endsAt: "",
        images: [],
    })
    const [errors, setErrors] = useState<string[]>([])


    const ui = useMemo(() => {
        const get = (ua: string, pl: string) => (lang === "pl" ? pl : ua);
        return {
            title: get("Додати", "Dodaj"),
            subtitle: get("Оголошення або аукціон", "Ogłoszenie albo aukcja"),
            modeLabel: get("Тип", "Typ"),
            modeAd: get("Оголошення", "Ogłoszenie"),
            modeAuction: get("Аукціон", "Aukcja"),

            fldTitle: get("Заголовок", "Tytuł"),
            fldDesc: get("Опис", "Opis"),
            fldCategory: get("Категорія", "Kategoria"),
            fldVoiv: get("Воєводство", "Województwo"),
            fldCity: get("Місто", "Miasto"),

            price: get("Ціна", "Cena"),
            startPrice: get("Стартова ціна", "Cena startowa"),
            buyNow: get("Ціна “Купити зараз” (необовʼязково)", "Kup teraz (opcjonalnie)"),
            endsAt: get("Завершення аукціону", "Koniec aukcji"),

            photos: get("Фото", "Zdjęcia"),
            photosHintAd: get("Фото необовʼязкове", "Zdjęcie opcjonalne"),
            photosHintAuction: get("Для аукціону потрібно мінімум 1 фото", "Dla aukcji wymagane min. 1 zdjęcie"),

            addPhotoMock: get("Додати фото (mock)", "Dodaj zdjęcie (mock)"),

            safetyTitle: get("Безпека", "Bezpieczeństwo"),
            safetyText: get(
                "Не надсилай передоплату незнайомим. Перевіряй деталі зустрічі.",
                "Nie wysyłaj przedpłat nieznajomym. Sprawdzaj szczegóły spotkania."
            ),

            submit: get("Опублікувати (mock)", "Opublikuj (mock)"),
            cancel: get("Скасувати", "Anuluj"),

            errorsTitle: get("Перевір поля", "Sprawdź pola"),
        };
    }, [lang]);
    useEffect(() => {
        if (!user) {
            alert(
                lang === "pl"
                    ? "Musisz się zalogować"
                    : "Потрібно увійти в акаунт"
            )
            nav("/account")
        }
    }, [user, lang, nav])

    // 4️⃣ return после хуков
    if (!user) return null
    const currentUser = user



    function set<K extends keyof AddFormState>(key: K, value: AddFormState[K]) {
        setForm(prev => ({ ...prev, [key]: value }));
    }

    function validate(): string[] {
        const e: string[] = [];

        if (!form.title.trim()) e.push(lang === "pl" ? "Brak tytułu" : "Немає заголовка");
        if (!form.description.trim()) e.push(lang === "pl" ? "Brak opisu" : "Немає опису");
        if (!form.category) e.push(lang === "pl" ? "Wybierz kategorię" : "Обери категорію");
        if (!form.voivodeship) e.push(lang === "pl" ? "Wybierz województwo" : "Обери воєводство");
        if (form.voivodeship !== "all" && !form.city.trim()) {
            e.push(lang === "pl" ? "Brak miasta" : "Немає міста");
        }


        if (form.mode === "ad") {
            if (!form.priceText.trim()) e.push(lang === "pl" ? "Brak ceny" : "Немає ціни");
        }

        if (form.mode === "auction") {
            if (!form.startPriceText.trim()) e.push(lang === "pl" ? "Brak ceny startowej" : "Немає стартової ціни");
            if (!form.endsAt) e.push(lang === "pl" ? "Brak daty zakończenia" : "Немає дати завершення");
            if (form.images.length < 1) e.push(lang === "pl" ? "Dodaj min. 1 zdjęcie" : "Додай мінімум 1 фото");
        }

        if (form.mode === "auction") {
            const maxDuration = 7 * 24 * 60 * 60 * 1000
            const endsAtTs = new Date(form.endsAt).getTime()

            if (endsAtTs - Date.now() > maxDuration) {
                e.push(
                    lang === 'pl'
                        ? 'Aukcja może trwać maks. 7 dni'
                        : 'Аукціон може тривати максимум 7 днів'
                )
            }
        }



        return e;
    }

    function onSubmit() {
        const e = validate();
        setErrors(e);
        if (e.length) return;

        // На этом шаге мы НЕ сохраняем в ADS/AUCTIONS.
        // Просто показываем, что payload готов.

        if (form.mode === 'ad') {
            addLocalAd({
                id: Date.now(),
                title: form.title,
                description: form.description,
                category: form.category as Category,

                voivodeship: form.voivodeship,
                city: form.city,
                price: form.priceText,
                isPremium: false,
                image: undefined,
                createdAt: Date.now(),
                userId: String(currentUser.id),


            })
        } else {
            addLocalAuction({
                id: Date.now(),
                title: form.title,
                description: form.description,
                category: form.category,
                voivodeship: form.voivodeship,
                city: form.city,
                startPrice: Number(form.startPriceText),
                buyNowPrice: form.buyNowPriceText
                    ? Number(form.buyNowPriceText)
                    : undefined,
                endsAt: new Date(form.endsAt).getTime(),
                images: form.images,
                userId: currentUser.id,

                createdAt: Date.now(),
            })
        }




        alert(lang === "pl" ? "Gotowe (mock). Zobacz console." : "Готово (mock). Дивись console.");

        nav("/");
    }

    function addMockPhoto() {
        // Пока без real upload — добавляем заглушку
        const id = Math.floor(Math.random() * 1000);
        set("images", [...form.images, `mock://photo-${id}`]);
    }

    function removeMockPhoto(idx: number) {
        set("images", form.images.filter((_, i) => i !== idx));
    }
    const availableCities: readonly string[] =
        form.voivodeship && form.voivodeship !== "all"
            ? CITIES_BY_VOIVODESHIP[form.voivodeship as VoivodeshipKey] ?? []
            : [];



    return (
        <div className={styles.page}>
            <div className={styles.head}>
                <div className={styles.h1}>{ui.title}</div>
                <div className={styles.h2}>{ui.subtitle}</div>
            </div>

            {errors.length > 0 && (
                <div className={styles.warning}>
                    <div className={styles.warningTitle}>{ui.errorsTitle}</div>
                    <ul className={styles.warningList}>
                        {errors.map((x, i) => <li key={i}>{x}</li>)}
                    </ul>
                </div>
            )}

            <div className={styles.card}>
                <div className={styles.row}>
                    <div className={styles.label}>{ui.modeLabel}</div>
                    <div className={styles.segment}>
                        <button
                            className={`${styles.segBtn} ${form.mode === "ad" ? styles.segActive : ""}`}
                            onClick={() => set("mode", "ad")}
                            type="button"
                        >
                            {ui.modeAd}
                        </button>
                        <button
                            className={`${styles.segBtn} ${form.mode === "auction" ? styles.segActive : ""}`}
                            onClick={() => set("mode", "auction")}
                            type="button"
                        >
                            {ui.modeAuction}
                        </button>
                    </div>
                </div>
                <div className={styles.field}>
                    <div className={styles.label}>{ui.fldTitle}</div>
                    <input
                        className={styles.input}
                        value={form.title}
                        onChange={(e) => set("title", e.target.value)}
                        maxLength={80}
                        placeholder={lang === "pl" ? "Np. Rower górski" : "Напр. Гірський велосипед"}
                    />
                </div>


                <div className={styles.field}>
                    <div className={styles.label}>{ui.fldDesc}</div>
                    <textarea
                        className={styles.textarea}
                        value={form.description}
                        onChange={(e) => set("description", e.target.value)}
                        rows={5}
                        placeholder={lang === "pl" ? "Opis..." : "Опис..."}
                    />
                </div>

                <div className={styles.grid2}>
                    <div className={styles.field}>
                        <div className={styles.label}>{ui.fldCategory}</div>
                        <select
                            className={styles.input}
                            value={form.category}
                            onChange={(e) => set("category", e.target.value as Category)}
                        >
                            <option value="">{lang === "pl" ? "Wybierz..." : "Обери..."}</option>
                            {CATEGORIES.map(c => (
                                <option key={c.value} value={c.value}>
                                    {lang === "pl" ? c.pl : c.ua}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className={styles.field}>
                        <div className={styles.label}>{ui.fldVoiv}</div>
                        <select
                            className={styles.input}
                            value={form.voivodeship}
                            onChange={(e) => {
                                set("voivodeship", e.target.value);
                                set("city", "");
                            }}

                        >
                            <option value="">{lang === "pl" ? "Wybierz..." : "Обери..."}</option>
                            {VOIVODESHIPS.map(v => (
                                <option key={v.value} value={v.value}>
                                    {lang === "pl" ? v.pl : v.ua}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {form.voivodeship !== "all" && (
                    <div className={styles.field}>
                        <div className={styles.label}>{ui.fldCity}</div>
                        <select
                            className={styles.input}
                            value={form.city}
                            onChange={(e) => set("city", e.target.value)}
                            disabled={!form.voivodeship}
                        >
                            <option value="">
                                {form.voivodeship
                                    ? lang === "pl"
                                        ? "Wybierz miasto..."
                                        : "Обери місто..."
                                    : lang === "pl"
                                        ? "Najpierw województwo"
                                        : "Спочатку воєводство"}
                            </option>

                            {availableCities.map((city: string) => (
                                <option key={city} value={city}>
                                    {city}
                                </option>
                            ))}
                        </select>
                    </div>
                )}




                {form.mode === "ad" ? (
                    <div className={styles.field}>
                        <div className={styles.label}>{ui.price}</div>
                        <input
                            className={styles.input}
                            value={form.priceText}
                            onChange={(e) => set("priceText", e.target.value)}
                            placeholder={lang === "pl" ? "Np. 120 zł" : "Напр. 120 zł"}
                        />
                        <div className={styles.hint}>{ui.photosHintAd}</div>
                    </div>
                ) : (
                    <>
                        <div className={styles.grid2}>
                            <div className={styles.field}>
                                <div className={styles.label}>{ui.startPrice}</div>
                                <input
                                    className={styles.input}
                                    value={form.startPriceText}
                                    onChange={(e) => set("startPriceText", e.target.value)}
                                    placeholder={lang === "pl" ? "Np. 50" : "Напр. 50"}
                                    inputMode="decimal"
                                />
                            </div>
                            <div className={styles.field}>
                                <div className={styles.label}>{ui.buyNow}</div>
                                <input
                                    className={styles.input}
                                    value={form.buyNowPriceText}
                                    onChange={(e) => set("buyNowPriceText", e.target.value)}
                                    placeholder={lang === "pl" ? "Np. 200" : "Напр. 200"}
                                    inputMode="decimal"
                                />
                            </div>
                        </div>

                        <div className={styles.field}>
                            <div className={styles.label}>{ui.endsAt}</div>
                            <input
                                className={styles.input}
                                type="datetime-local"
                                value={form.endsAt}
                                onChange={(e) => set("endsAt", e.target.value)}
                            />
                        </div>
                    </>
                )}

                <div className={styles.cardInner}>
                    <div className={styles.rowBetween}>
                        <div>
                            <div className={styles.label}>{ui.photos}</div>
                            <div className={styles.hint}>
                                {form.mode === "auction" ? ui.photosHintAuction : ui.photosHintAd}
                            </div>
                        </div>
                        <button className={styles.btnGhost} type="button" onClick={addMockPhoto}>
                            {ui.addPhotoMock}
                        </button>
                    </div>

                    {form.images.length > 0 && (
                        <div className={styles.photos}>
                            {form.images.map((p, idx) => (
                                <div key={p} className={styles.photo}>
                                    <div className={styles.photoBox}>
                                        <div className={styles.photoText}>{p}</div>
                                    </div>
                                    <button
                                        className={styles.photoRemove}
                                        type="button"
                                        onClick={() => removeMockPhoto(idx)}
                                    >
                                        {lang === "pl" ? "Usuń" : "Видалити"}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className={styles.warning}>
                    <div className={styles.warningTitle}>{ui.safetyTitle}</div>
                    <div>{ui.safetyText}</div>
                </div>

                <div className={styles.actions}>
                    <button
                        className={styles.btnPrimary}
                        type="button"
                        onClick={onSubmit}
                    >
                        {ui.submit}
                    </button>
                    <button
                        className={styles.btn}
                        type="button"
                        onClick={() => nav(-1)}
                    >
                        {ui.cancel}
                    </button>
                </div>
            </div>
        </div>
    );
}
