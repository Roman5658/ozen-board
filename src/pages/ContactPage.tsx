import { useNavigate } from 'react-router-dom'
import type { translations } from '../app/i18n'

type Props = {
    t: (typeof translations)[keyof typeof translations]
}

function ContactPage({ t }: Props) {
    const navigate = useNavigate()
    const c = t.contact

    return (
        <div className="card stack12">
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
                {t.home.prev}
            </button>

            <h2>{c.title}</h2>

            <p>{c.intro}</p>

            <ul>
                <li>
                    <strong>{c.emailLabel}:</strong> ozenenesis@gmail.com
                </li>
                <li>
                    <strong>{c.telegramLabel}:</strong> @Ozen25
                </li>
            </ul>
        </div>
    )
}

export default ContactPage
