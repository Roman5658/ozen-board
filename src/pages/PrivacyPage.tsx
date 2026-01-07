import { useNavigate } from 'react-router-dom'

function PrivacyPage() {
    const navigate = useNavigate()

    return (
        <div className="card">
            <button
                onClick={() => navigate(-1)}
                style={{
                    marginBottom: 12,
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    cursor: 'pointer',
                    fontSize: 14,
                }}
            >
                ← Назад
            </button>

            <h1>Політика конфіденційності</h1>

            <p><strong>Ozen Board</strong> — це онлайн-платформа оголошень та аукціонів, що працює на території Польщі.</p>

            <h3>1. Загальні положення</h3>
            <p>Ми поважаємо вашу конфіденційність і зобов’язуємося захищати персональні дані користувачів сервісу Ozen Board.</p>

            <h3>2. Які дані ми збираємо</h3>
            <ul>
                <li>адресу електронної пошти;</li>
                <li>дані оголошень та аукціонів;</li>
                <li>технічну інформацію (cookies, мова);</li>
                <li>інформацію про платежі (без зберігання карток).</li>
            </ul>

            <h3>3. Платежі</h3>
            <p>Усі платежі здійснюються через PayPal. Ми не зберігаємо платіжні реквізити.</p>

            <h3>4. Використання даних</h3>
            <p>Дані використовуються для роботи платформи та платних послуг.</p>

            <h3>5. Передача даних</h3>
            <p>Передача здійснюється лише необхідним сервісам (PayPal, Firebase).</p>

            <h3>6. Зберігання</h3>
            <p>Дані зберігаються у Firebase (Google).</p>

            <h3>7. Права користувача</h3>
            <p>Користувач може видалити акаунт або оголошення.</p>

            <h3>8. Контакти</h3>
            <p>Email: ozenenesis@gmail.com<br />Telegram: @Ozen25</p>
        </div>
    )
}

export default PrivacyPage
