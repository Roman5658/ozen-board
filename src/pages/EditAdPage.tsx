import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { deleteField, doc, getDoc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../app/firebase";
import { getLocalUser } from "../data/localUser";
import { CITIES_BY_VOIVODESHIP } from "../data/cities";
import type { Ad } from "../types/ad";
import { buildAdPath } from '../utils/slug';
import { getStoredAdImages, handleListingImageError } from "../utils/getAdImages";
import {
    getImageUploadContentType,
    IMAGE_FILE_ACCEPT,
    MAX_AD_IMAGES,
    UnsupportedImageFormatError,
    optimizeAdImages,
    validateImageFiles,
} from "../utils/imageOptimization";

type VoivodeshipKey = keyof typeof CITIES_BY_VOIVODESHIP;

function EditAdPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const user = useMemo(() => getLocalUser(), []);

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
    const [sellerContact, setSellerContact] = useState("");
    const [existingImages, setExistingImages] = useState<string[]>([]);
    const [imageFiles, setImageFiles] = useState<File[]>([]);

    const cityOptions = useMemo(() => {
        const key = voivodeship as VoivodeshipKey;
        return [...(CITIES_BY_VOIVODESHIP[key] ?? [])];
    }, [voivodeship]);

    const imagePreviews = useMemo(
        () => imageFiles.map((file) => URL.createObjectURL(file)),
        [imageFiles],
    );

    useEffect(() => {
        return () => {
            imagePreviews.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [imagePreviews]);

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
                setSellerContact(loaded.sellerContact ?? "");
                setExistingImages(getStoredAdImages(loaded));
            } catch (e) {
                console.error(e);
                setError("Помилка завантаження оголошення");
            } finally {
                setLoading(false);
            }
        }

        load();
    }, [id, user]);

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

        const normalizedPrice = price.trim();

        if (!normalizedPrice) {
            setError("Вкажіть ціну");
            return;
        }

        if (normalizedPrice.length > 40) {
            setError("Ціна занадто довга");
            return;
        }

        try {
            setSaving(true);

            const adRef = doc(db, "ads", ad.id);
            const timestamp = Date.now();
            const uploadedImages: string[] = [];
            let optimizedImages: File[] = [];

            try {
                optimizedImages = await optimizeAdImages(imageFiles);
            } catch (error) {
                if (error instanceof UnsupportedImageFormatError) {
                    setError(
                        `Файл «${error.fileName}» не підтримується. Дозволені лише JPG, JPEG, PNG, WebP, HEIC і HEIF.`,
                    );
                    return;
                }

                throw error;
            }

            for (const [index, file] of optimizedImages.entries()) {
                const imageRef = ref(
                    storage,
                    `ads/${ad.userId}/${timestamp}-${index}-${file.name}`,
                );

                await uploadBytes(imageRef, file, {
                    contentType: getImageUploadContentType(file),
                });
                uploadedImages.push(await getDownloadURL(imageRef));
            }

            const nextImages = [...existingImages, ...uploadedImages];
            const normalizedContact = sellerContact.trim();

            await updateDoc(adRef, {
                title: title.trim(),
                description: description.trim(),
                price: normalizedPrice,
                voivodeship,
                city,
                sellerContact: normalizedContact || deleteField(),
                ...(uploadedImages.length > 0 ? { images: nextImages } : {}),
            });

            navigate(buildAdPath(title.trim(), city, ad.id));
        } catch (e) {
            console.error(e);
            setError("Помилка збереження");
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="card">Завантаження…</div>;

    if (error && !ad) {
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

                <input
                    className="input"
                    placeholder="Контакт (телефон / Telegram) — необовʼязково"
                    value={sellerContact}
                    onChange={(e) => setSellerContact(e.target.value)}
                    maxLength={120}
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

                <div className="stack8">
                    <strong style={{ fontSize: 14 }}>Фото</strong>

                    {existingImages.length > 0 && (
                        <>
                            <div style={{ fontSize: 12, color: "#64748b" }}>
                                Поточні фото будуть збережені.
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {existingImages.map((image, index) => (
                                    <img
                                        key={`${image}-${index}`}
                                        src={image}
                                        alt={`Поточне фото ${index + 1}`}
                                        onError={handleListingImageError}
                                        style={{
                                            width: 80,
                                            height: 80,
                                            objectFit: "cover",
                                            borderRadius: 8,
                                            border: "1px solid #e5e7eb",
                                        }}
                                    />
                                ))}
                            </div>
                        </>
                    )}

                    {existingImages.length === 0 && imageFiles.length === 0 && (
                        <div style={{ fontSize: 12, color: "#64748b" }}>
                            В оголошенні немає фото. Фото не обовʼязкове.
                        </div>
                    )}

                    <div style={{ fontSize: 12, color: "#64748b" }}>
                        Фото будуть автоматично стиснуті перед завантаженням. Максимум {MAX_AD_IMAGES} фото.
                    </div>

                    <input
                        type="file"
                        accept={IMAGE_FILE_ACCEPT}
                        multiple
                        disabled={saving || existingImages.length + imageFiles.length >= MAX_AD_IMAGES}
                        onChange={(e) => {
                            const newFiles = Array.from(e.target.files ?? []);

                            try {
                                validateImageFiles(newFiles);
                            } catch (error) {
                                const fileName = error instanceof UnsupportedImageFormatError
                                    ? error.fileName
                                    : "";
                                setError(
                                    `Файл «${fileName}» не підтримується. Дозволені лише JPG, JPEG, PNG, WebP, HEIC і HEIF.`,
                                );
                                e.currentTarget.value = "";
                                return;
                            }

                            if (existingImages.length + imageFiles.length + newFiles.length > MAX_AD_IMAGES) {
                                setError(`Максимум ${MAX_AD_IMAGES} фото`);
                                e.currentTarget.value = "";
                                return;
                            }

                            setError(null);
                            setImageFiles((current) => [...current, ...newFiles]);
                            e.currentTarget.value = "";
                        }}
                    />

                    {imagePreviews.length > 0 && (
                        <>
                            <div style={{ fontSize: 12, color: "#64748b" }}>
                                Нові фото будуть додані після збереження.
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {imagePreviews.map((image, index) => (
                                    <div
                                        key={image}
                                        style={{
                                            position: "relative",
                                            width: 80,
                                            height: 80,
                                            borderRadius: 8,
                                            overflow: "hidden",
                                            border: "1px solid #e5e7eb",
                                        }}
                                    >
                                        <img
                                            src={image}
                                            alt={`Нове фото ${index + 1}`}
                                            style={{
                                                width: "100%",
                                                height: "100%",
                                                objectFit: "cover",
                                            }}
                                        />
                                        <button
                                            type="button"
                                            aria-label="Видалити нове фото"
                                            onClick={() => {
                                                setImageFiles((current) =>
                                                    current.filter((_, fileIndex) => fileIndex !== index),
                                                );
                                            }}
                                            style={{
                                                position: "absolute",
                                                top: 4,
                                                right: 4,
                                                width: 22,
                                                height: 22,
                                                borderRadius: "50%",
                                                border: "none",
                                                background: "rgba(0,0,0,0.6)",
                                                color: "#fff",
                                                cursor: "pointer",
                                            }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>

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

            </form>
        </div>
    );
}

export default EditAdPage;
