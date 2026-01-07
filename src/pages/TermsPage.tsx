import { useNavigate } from 'react-router-dom'

function TermsPage() {
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

                <h1>Умови користування</h1>

                <p><strong>Ozen Board</strong> — це онлайн-платформа оголошень та аукціонів, що працює на території
                        Польщі.</p>

                <h3>1. Загальні положення</h3>
                <p>Користуючись платформою, ви погоджуєтеся з цими умовами.</p>

                <h3>2. Відповідальність платформи</h3>
                <p>Ozen Board не є стороною угод між користувачами.</p>

                <h3>3. Відповідальність користувачів</h3>
                <p>Користувачі самі відповідають за свої дії та оголошення.</p>

                <h3>4. Платні послуги</h3>
                <p>Після активації платних послуг кошти не повертаються.</p>

                <h3>5. Видалення контенту</h3>
                <p>Адміністрація може видаляти контент, що порушує правила.</p>

                <h3>6. Зміни умов</h3>
                <p>
                        Умови користування можуть оновлюватися у разі змін у роботі сервісу.
                        Актуальна версія завжди доступна на цій сторінці.
                </p>


                <h3>7. Контакти</h3>
                <p>Email: ozenenesis@gmail.com<br/>Telegram: @Ozen25</p>
        </div>
    )
}

export default TermsPage
