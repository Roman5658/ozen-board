import { useNavigate } from 'react-router-dom'
import type { translations } from '../app/i18n'

type Props = {
    t: (typeof translations)[keyof typeof translations]
}

function SafetyPage({ t }: Props) {
    const navigate = useNavigate()
    const p = t.safety

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
            <p>{p.intro}</p>

            {p.sections.map(section => (
                <section key={section.title}>
                    <h3>{section.title}</h3>
                    <p>{section.text}</p>
                    {section.items.length > 0 && (
                        <ul>
                            {section.items.map(item => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    )}
                </section>
            ))}

            <h3>{p.prohibitedTitle}</h3>
            <p>{p.prohibitedText}</p>
            <ul>
                {p.prohibitedList.map(item => (
                    <li key={item}>{item}</li>
                ))}
            </ul>
        </div>
    )
}

export default SafetyPage
