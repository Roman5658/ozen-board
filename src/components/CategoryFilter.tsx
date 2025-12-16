type Category = 'all' | 'work' | 'buySell' | 'services'

type Props = {
    value: Category
    onChange: (c: Category) => void
    t: {
        categories: {
            all: string
            work: string
            buySell: string
            services: string
        }
    }
}

function CategoryFilter({ value, onChange, t }: Props) {
    return (
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', marginBottom: '12px' }}>
            {(Object.keys(t.categories) as Category[]).map((key) => (
                <button
                    key={key}
                    onClick={() => onChange(key)}
                    style={{
                        padding: '6px 12px',
                        borderRadius: '16px',
                        border: value === key ? '1px solid #111' : '1px solid #ccc',
                        background: value === key ? '#111' : '#fff',
                        color: value === key ? '#fff' : '#111',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {t.categories[key]}
                </button>
            ))}
        </div>
    )
}

export default CategoryFilter
