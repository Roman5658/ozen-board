import { useCallback, useEffect, useState } from "react"
import {
    getTelegramListingsWebhookStatus,
    registerTelegramListingsWebhook,
    type TelegramWebhookStatus,
} from "../api/telegramListingsAdmin"
import { getLocalUser } from "../data/localUser"
import { requireMatchingFirebaseUser } from "../data/authGuard"

function errorMessage(error: unknown): string {
    return error instanceof Error && error.message
        ? error.message
        : "Не вдалося виконати запит. Спробуйте ще раз."
}

function formatDate(timestamp: number | null): string {
    return timestamp === null
        ? "Немає даних"
        : new Date(timestamp * 1000).toLocaleString()
}

export default function AdminTelegramPage() {
    const [status, setStatus] = useState<TelegramWebhookStatus | null>(null)
    const [loadingStatus, setLoadingStatus] = useState(true)
    const [registering, setRegistering] = useState(false)
    const [error, setError] = useState("")
    const [message, setMessage] = useState("")

    const loadStatus = useCallback(async () => {
        setLoadingStatus(true)
        setError("")
        setMessage("")
        try {
            await requireMatchingFirebaseUser(getLocalUser())
            const currentStatus = await getTelegramListingsWebhookStatus()
            setStatus(currentStatus)
        } catch (requestError) {
            setStatus(null)
            setError(errorMessage(requestError))
        } finally {
            setLoadingStatus(false)
        }
    }, [])

    useEffect(() => {
        void loadStatus()
    }, [loadStatus])

    const canRegister = status !== null && !status.registered && !loadingStatus && !registering

    async function handleRegister() {
        if (!canRegister) return

        setRegistering(true)
        setError("")
        setMessage("")
        try {
            await requireMatchingFirebaseUser(getLocalUser())
            await registerTelegramListingsWebhook()
            setMessage("Запит на реєстрацію виконано. Перевіряємо оновлений статус…")
            await loadStatus()
        } catch (requestError) {
            setError(errorMessage(requestError))
        } finally {
            setRegistering(false)
        }
    }

    return (
        <section className="admin-telegram-page" aria-labelledby="admin-telegram-title">
            <header className="admin-telegram-page__header">
                <div>
                    <h1 id="admin-telegram-title">Telegram-імпорт</h1>
                    <p>Перевірка webhook і ручна реєстрація для підключеного бота.</p>
                </div>
                <button
                    type="button"
                    onClick={() => void loadStatus()}
                    disabled={loadingStatus || registering}
                >
                    {loadingStatus ? "Перевіряємо…" : "Оновити статус"}
                </button>
            </header>

            <div className="admin-telegram-page__notice" role="note">
                Статус надходить із захищеної callable-функції. Реєстрація виконується лише після натискання кнопки нижче.
            </div>

            {error && <p className="admin-telegram-page__message admin-telegram-page__message--error" role="alert">{error}</p>}
            {message && <p className="admin-telegram-page__message" role="status">{message}</p>}

            {status && (
                <dl className="admin-telegram-page__status">
                    <div>
                        <dt>Webhook</dt>
                        <dd>{status.registered ? "Зареєстрований" : "Не зареєстрований"}</dd>
                    </div>
                    <div>
                        <dt>Адреса відповідає конфігурації</dt>
                        <dd>{status.configuredEndpointMatches ? "Так" : status.registered ? "Ні" : "Немає активного webhook"}</dd>
                    </div>
                    <div>
                        <dt>Очікує оновлень</dt>
                        <dd>{status.pendingUpdateCount ?? "Немає даних"}</dd>
                    </div>
                    <div>
                        <dt>Максимум з’єднань</dt>
                        <dd>{status.maxConnections ?? "Немає даних"}</dd>
                    </div>
                    <div>
                        <dt>Дозволені типи оновлень</dt>
                        <dd>{status.allowedUpdates.length ? status.allowedUpdates.join(", ") : "Немає даних"}</dd>
                    </div>
                    <div>
                        <dt>Остання помилка Telegram</dt>
                        <dd>{formatDate(status.lastErrorDate)}</dd>
                    </div>
                </dl>
            )}

            {status?.registered && !status.configuredEndpointMatches && (
                <p className="admin-telegram-page__message admin-telegram-page__message--error" role="alert">
                    Зареєстровано інший webhook. Ця сторінка не замінює та не видаляє його.
                </p>
            )}

            <div className="admin-telegram-page__actions">
                <button
                    type="button"
                    className="admin-telegram-page__register"
                    onClick={() => void handleRegister()}
                    disabled={!canRegister}
                >
                    {registering ? "Реєструємо…" : "Зареєструвати Telegram webhook"}
                </button>
                {status?.registered && status.configuredEndpointMatches && (
                    <span>Webhook уже зареєстрований для налаштованої адреси.</span>
                )}
                {status?.registered && !status.configuredEndpointMatches && (
                    <span>Реєстрацію заблоковано, щоб не перезаписати іншу адресу.</span>
                )}
            </div>
        </section>
    )
}
