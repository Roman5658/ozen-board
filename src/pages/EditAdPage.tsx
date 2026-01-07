import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../app/firebase";
import { getLocalUser } from "../data/localUser";
import { CITIES_BY_VOIVODESHIP } from "../data/cities";
import type { Ad } from "../types/ad";

type VoivodeshipKey = keyof typeof CITIES_BY_VOIVODESHIP;

function EditAdPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const user = getLocalUser();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [ad, setAd] = useState<Ad | null>(null);

    // form fields (MVP)
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [price, setPrice] = useState("");
    const [voivodeship, setVoivodeship] = useState("");
    const [city, setCity] = useState("");

    const cityOptions = useMemo(() => {
        const key = voivodeship as VoivodeshipKey;
        return [...(CITIES_BY_VOIVODESHIP[key] ?? [])];
    }, [voivodeship]);


    useEffect(() => {
        async function load() {
            try {
                setError(null);
                if (!id) {
                    setError("Немає id оголошення");
                    return;
                }
                if (!user) {
                    setError("Спочатку увійдіть в акаунт");
                    return;
                }

                const ref = doc(db, "ads", id);
                const snap = await getDoc(ref);

                if (!snap.exists()) {
                    setError("Оголошення не знайдено");
                    return;
                }

                const loaded = { id, ...(snap.data() as Omit<Ad, "id">) } as Ad;

                // owner guard
                if (loaded.status !== "active") {
                    setError("Це оголошення не можна редагувати");
                    return;
                }
                const now = Date.now();

                if (
                    (loaded.pinnedUntil && loaded.pinnedUntil > now) ||
                    (loaded.highlightUntil && loaded.highlightUntil > now)
                ) {
                    setError("Редагування недоступне під час активного просування");
                    return;
                }

                if (String(loaded.userId) !== String(user.id)) {
                    setError("У вас немає прав редагувати це оголошення");
                    return;
                }

                setAd(loaded);

                // init form
                setTitle(loaded.title ?? "");
                setDescription(loaded.description ?? "");
                setPrice(loaded.price ? String(loaded.price) : "");
                setVoivodeship(loaded.voivodeship ?? "");
                setCity(loaded.city ?? "");
            } catch (e) {
                console.error(e);
                setError("Помилка завантаження оголошення");
            } finally {
                setLoading(false);
            }
        }

        load();
    }, [id]);

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        if (!ad) return;
        if (!user) {
            setError("Спочатку увійдіть в акаунт");
            return;
        }

        if (!title.trim() || !description.trim() || !voivodeship || !city) {
            setError("Заповніть усі обовʼязкові поля");
            return;
        }

        const priceNumber = price.trim() ? Number(price) : null;
        if (price.trim() && Number.isNaN(priceNumber)) {
            setError("Некоректна ціна");
            return;
        }

        try {
            setSaving(true);

            const ref = doc(db, "ads", ad.id);

            await updateDoc(ref, {
                title: title.trim(),
                description: description.trim(),
                price: priceNumber,
                voivodeship,
                city,
                updatedAt: Date.now(),
            });

            navigate(`/ad/${ad.id}`);
        } catch (e) {
            console.error(e);
            setError("Помилка збереження");
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="card">Завантаження…</div>;

    if (error) {
        return (
            <div className="card stack12">
                <div style={{ color: "#b91c1c" }}>{error}</div>
                <button className="btn-secondary" onClick={() => navigate(-1)}>
                    ← Назад
                </button>
            </div>
        );
    }

    return (
        <div className="card stack12">
            <h2 className="h2">Редагування оголошення</h2>

            <form className="stack12" onSubmit={handleSave}>
                <input
                    className="input"
                    placeholder="Заголовок"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                />

                <textarea
                    className="input"
                    placeholder="Опис"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={5}
                />

                <input
                    className="input"
                    placeholder="Ціна (необовʼязково)"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    inputMode="decimal"
                />

                <select
                    className="input"
                    value={voivodeship}
                    onChange={(e) => {
                        setVoivodeship(e.target.value);
                        setCity("");
                    }}
                >
                    <option value="">Воєводство</option>
                    {Object.keys(CITIES_BY_VOIVODESHIP).map((v) => (
                        <option key={v} value={v}>
                            {v}
                        </option>
                    ))}
                </select>

                {voivodeship && (
                    <select
                        className="input"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                    >
                        <option value="">Місто</option>
                        {cityOptions.map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </select>
                )}

                {error && <div style={{ color: "#b91c1c" }}>{error}</div>}

                <div style={{ display: "flex", gap: 8 }}>
                    <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => navigate(-1)}
                        disabled={saving}
                    >
                        Скасувати
                    </button>

                    <button className="btn-primary" disabled={saving}>
                        {saving ? "Збереження…" : "Зберегти"}
                    </button>
                </div>

                <div style={{ fontSize: 12, color: "#6b7280" }}>
                    Фото та інші поля додамо наступним кроком.
                </div>
            </form>
        </div>
    );
}

export default EditAdPage;
