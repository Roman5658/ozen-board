import { useState } from 'react'

type Props = {
    title: string
    subtitle: string
    warning: string
    lang: 'uk' | 'pl'
    languages: {
        uk: string
        pl: string
    }
    onLangChange: (lang: 'uk' | 'pl') => void
}



function Header({ title, subtitle,warning, lang, languages, onLangChange }: Props) {
    const [flash, setFlash] = useState<'uk' | 'pl' | null>(null)

    return (
        <header
            style={{
                padding: '12px 16px',
                borderBottom: '1px solid #ddd',
                background: '#fff',

            }}
        >
            <div style={{display: 'flex', justifyContent: 'space-around', alignItems: 'center'}}>
                <div>
                    <h1 style={{margin: 0, fontSize: '18px'}}>{title}</h1>
                    <p style={{
                        display: 'flex',
                        justifyContent: 'center',
                        margin: 0,
                        alignItems: 'center',
                        fontSize: '12px',
                        color: '#666'
                    }}>{subtitle}</p>
                </div>

                <div style={{display: 'flex', gap: '10px',}}>
                    <button
                        onClick={() => {
                            setFlash('uk')
                            onLangChange('uk')
                            setTimeout(() => setFlash(null), 3200)



                        }}
                        disabled={lang === 'uk'}
                        style={{
                            minWidth: '100px',
                            height: '42px',
                            borderRadius: '6px',
                            border: '3px solid transparent',
                            background: `
linear-gradient(#fff, #fff) padding-box,
linear-gradient(to bottom, #0057B7, #FFD700) border-box
`,
                            boxShadow: `
0 0 4px rgba(0, 87, 183, 0.8),
0 0 8px rgba(0, 87, 183, 0.6),
0 0 12px rgba(255, 215, 0, 0.7),
0 0 18px rgba(255, 215, 0, 0.5)
`,
                            fontWeight: 800,
                            cursor: 'pointer',
                            opacity: lang === 'uk' ? 1 : 0.7,
                            position: 'relative',
                            overflow: 'hidden',
                        }}
                    >
                        {flash === 'uk' && (
                            <div
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    background: `
linear-gradient(
  45deg,
  transparent 10%,
  rgba(255,255,255,0.12) 22%,
  rgba(255,255,255,0.30) 32%,
  rgba(0,87,183,0.45) 42%,
  rgba(255,215,0,0.65) 50%,
  rgba(0,87,183,0.45) 58%,
  rgba(255,255,255,0.30) 68%,
  rgba(255,255,255,0.12) 78%,
  transparent 90%
)
`,
                                    filter: 'blur(1.4px)',




                                    animation: 'btnFlash 2.8s linear',



                                    pointerEvents: 'none',
                                }}
                            />
                        )}

                        {languages.uk}
                    </button>

                    <button
                        onClick={() => {
                            setFlash('pl')
                            onLangChange('pl')
                            setTimeout(() => setFlash(null), 3200)



                        }}
                        disabled={lang === 'pl'}
                        style={{
                            minWidth: '100px',
                            height: '42px',
                            borderRadius: '6px',
                            border: '3px solid transparent',
                            background: `
linear-gradient(#fff, #fff) padding-box,
linear-gradient(to bottom, #ffffff, #dc143c) border-box
`,
                            boxShadow: `
0 0 4px rgba(220, 20, 60, 0.8),
0 0 8px rgba(220, 20, 60, 0.6),
0 0 12px rgba(255, 255, 255, 0.9),
0 0 18px rgba(220, 20, 60, 0.5)
`,
                            fontWeight: 800,
                            cursor: 'pointer',
                            opacity: lang === 'pl' ? 1 : 0.7,
                            position: 'relative',
                            overflow: 'hidden',
                        }}
                    >
                        {flash === 'pl' && (
                            <div
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    background: `
linear-gradient(
  45deg,
  transparent 10%,
  rgba(255,255,255,0.15) 22%,
  rgba(255,255,255,0.40) 32%,
  rgba(255,255,255,0.85) 42%,
  rgba(220,20,60,0.65) 50%,
  rgba(255,255,255,0.45) 58%,
  rgba(255,255,255,0.35) 68%,
  rgba(255,255,255,0.15) 78%,
  transparent 90%
)
`,
                                    filter: 'blur(1.4px)',




                                    animation: 'btnFlash 2.8s linear',


                                    pointerEvents: 'none',
                                }}
                            />
                        )}

                        {languages.pl}
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

                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    textAlign: 'center',
                    gap: '6px',
                }}
            >
                ⚠️ {warning}
            </div>

        </header>
    )
}

export default Header
