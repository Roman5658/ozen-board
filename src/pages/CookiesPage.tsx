import { useNavigate } from 'react-router-dom'
import type { translations } from '../app/i18n'

type Props = {
    t: (typeof translations)[keyof typeof translations]
}

function CookiesPage({ t }: Props) {
    const navigate = useNavigate()
    const c = t.cookies

    return (
        <div className="static-page">
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
                ← {t.home.prev.replace('← ', '')}
            </button>

            <h1>{c.title}</h1>

            <p>{c.intro}</p>

            <h2>{c.sections.whatTitle}</h2>
            <p>{c.sections.whatText}</p>

            <h2>{c.sections.typesTitle}</h2>
            <ul>
                {c.sections.typesList.map(item => (
                    <li key={item}>{item}</li>
                ))}
            </ul>

            <h2>{c.sections.notTitle}</h2>
            <ul>
                {c.sections.notList.map(item => (
                    <li key={item}>{item}</li>
                ))}
            </ul>

            <h2>{c.sections.controlTitle}</h2>
            <p>{c.sections.controlText}</p>

            <p>{c.sections.consentText}</p>
        </div>
    )
}

export default CookiesPage
