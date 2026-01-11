import { useNavigate } from 'react-router-dom'
import type { translations } from '../app/i18n'

type Props = {
    t: (typeof translations)[keyof typeof translations]
}

function TermsPage({ t }: Props) {
    const navigate = useNavigate()
    const p = t.terms

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
                {p.back}
            </button>

            <h1>{p.title}</h1>

            <p>
                <strong>Ozen Board</strong> — {p.intro}
            </p>

            <h3>{p.sections.generalTitle}</h3>
            <p>{p.sections.generalText}</p>

            <h3>{p.sections.platformTitle}</h3>
            <p>{p.sections.platformText}</p>

            <h3>{p.sections.usersTitle}</h3>
            <p>{p.sections.usersText}</p>

            <h3>{p.sections.paidTitle}</h3>
            <p>{p.sections.paidText}</p>

            <h3>{p.sections.removalTitle}</h3>
            <p>{p.sections.removalText}</p>

            <h3>{p.sections.changesTitle}</h3>
            <p>{p.sections.changesText}</p>

            <h3>{p.sections.contactsTitle}</h3>
            <p style={{ whiteSpace: 'pre-line' }}>
                {p.sections.contactsText}
            </p>
        </div>
    )
}

export default TermsPage
