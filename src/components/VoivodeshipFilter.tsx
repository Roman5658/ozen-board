type Voivodeship =
    | 'all'
    | 'dolnoslaskie'
    | 'kujawskoPomorskie'
    | 'lubelskie'
    | 'lubuskie'
    | 'lodzkie'
    | 'malopolskie'
    | 'mazowieckie'
    | 'opolskie'
    | 'podkarpackie'
    | 'podlaskie'
    | 'pomorskie'
    | 'slaskie'
    | 'swietokrzyskie'
    | 'warminskoMazurskie'
    | 'wielkopolskie'
    | 'zachodniopomorskie'

type Props = {
    value: Voivodeship
    onChange: (v: Voivodeship) => void
    t: {
        voivodeships: Record<Voivodeship, string>
    }
}

function VoivodeshipFilter({ value, onChange, t }: Props) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value as Voivodeship)}
            style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid #ccc',
                marginBottom: '8px',
                fontSize: '14px',
            }}
        >
            {(Object.keys(t.voivodeships) as Voivodeship[]).map((key) => (
                <option key={key} value={key}>
                    {t.voivodeships[key]}
                </option>
            ))}
        </select>
    )
}

export default VoivodeshipFilter
