import { useNavigate } from 'react-router-dom'
import type { translations } from '../app/i18n'

type Props = {
    t: (typeof translations)[keyof typeof translations]
}

function PrivacyPage({ t }: Props) {
    const navigate = useNavigate()
    const p = t.privacy

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
                <strong>Xoven</strong> — {p.intro}
            </p>

            <h3>{p.sections.generalTitle}</h3>
            <p>{p.sections.generalText}</p>

            <h3>{p.sections.dataTitle}</h3>
            <ul>
                {p.sections.dataList.map(item => (
                    <li key={item}>{item}</li>
                ))}
            </ul>

            <h3>{p.sections.authTitle}</h3>
            <p>{p.sections.authText}</p>

            <h3>{p.sections.contentTitle}</h3>
            <p>{p.sections.contentText}</p>

            <h3>{p.sections.chatsTitle}</h3>
            <p>{p.sections.chatsText}</p>

            <h3>{p.sections.paymentsTitle}</h3>
            <p>{p.sections.paymentsText}</p>

            <h3>{p.sections.logsTitle}</h3>
            <p>{p.sections.logsText}</p>

            <h3>{p.sections.receiptsTitle}</h3>
            <p>{p.sections.receiptsText}</p>

            <h3>{p.sections.localStorageTitle}</h3>
            <p>{p.sections.localStorageText}</p>

            <h3>{p.sections.usageTitle}</h3>
            <p>{p.sections.usageText}</p>

            <h3>{p.sections.transferTitle}</h3>
            <p>{p.sections.transferText}</p>

            <h3>{p.sections.storageTitle}</h3>
            <p>{p.sections.storageText}</p>

            <h3>{p.sections.rightsTitle}</h3>
            <p>{p.sections.rightsText}</p>

            <h3>{p.sections.deletionTitle}</h3>
            <p>{p.sections.deletionText}</p>

            <h3>{p.sections.contactsTitle}</h3>
            <p style={{ whiteSpace: 'pre-line' }}>
                {p.sections.contactsText}
            </p>
        </div>
    )
}

export default PrivacyPage
