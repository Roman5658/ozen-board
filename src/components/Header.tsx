type Props = {
    title: string
    subtitle: string
    warning: string
    lang: 'uk' | 'pl'
    onLangChange: (lang: 'uk' | 'pl') => void
}


function Header({ title, subtitle,warning, lang, onLangChange }: Props) {
    return (
        <header
            style={{
                padding: '12px 16px',
                borderBottom: '1px solid #ddd',
                background: '#fff',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '18px' }}>{title}</h1>
                    <p style={{ margin: 0, fontSize: '12px', color: '#666' }}>{subtitle}</p>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                        onClick={() => onLangChange('uk')}
                        disabled={lang === 'uk'}
                    >
                        UA
                    </button>
                    <button
                        onClick={() => onLangChange('pl')}
                        disabled={lang === 'pl'}
                    >
                        PL
                    </button>
                </div>
            </div>

            <div
                style={{
                    marginTop: '8px',
                    fontSize: '12px',
                    color: '#b71c1c',
                    background: '#fdecea',
                    padding: '6px 8px',
                    borderRadius: '6px',
                }}
            >
                ⚠️ {warning}

            </div>
        </header>
    )
}

export default Header
