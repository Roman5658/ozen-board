import { CITIES_BY_VOIVODESHIP } from '../data/cities'

type Voivodeship = keyof typeof CITIES_BY_VOIVODESHIP | 'all'

type Props = {
    voivodeship: Voivodeship
    value: string
    onChange: (city: string) => void
}

function CityByVoivodeshipFilter({ voivodeship, value, onChange }: Props) {
    if (voivodeship === 'all') return null

    const cities = CITIES_BY_VOIVODESHIP[voivodeship]

    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid #ccc',
                marginBottom: '12px',
                fontSize: '14px',
            }}
        >
            <option value="">Всі міста</option>
            {cities.map((city) => (
                <option key={city} value={city}>
                    {city}
                </option>
            ))}
        </select>
    )
}

export default CityByVoivodeshipFilter
