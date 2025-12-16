import { useParams, useNavigate } from 'react-router-dom'
import { ADS } from '../data/ads'
import { getLocalAds } from '../data/localAds'
function AdDetailsPage() {
    const { id } = useParams()
    const navigate = useNavigate()

    const allAds = [...getLocalAds(), ...ADS]
    const ad = allAds.find(a => a.id === Number(id))


    if (!ad) {
        return <div className="card">Оголошення не знайдено</div>
    }

    return (
        <div className="stack12">
            <button
                onClick={() => navigate(-1)}
                style={{
                    background: 'none',
                    border: 'none',
                    color: '#1976d2',
                    padding: 0,
                    fontSize: '14px',
                    cursor: 'pointer',
                }}
            >
                ← Назад
            </button>

            <div className="card stack12">
                <h2 className="h2">{ad.title}</h2>

                <div style={{ fontSize: '14px', color: '#6b7280' }}>
                    {ad.city} · {ad.voivodeship}
                </div>

                {ad.price && (
                    <div style={{ fontSize: '20px', fontWeight: 700 }}>
                        {ad.price}
                    </div>
                )}

                {/* Фото */}
                <div
                    style={{
                        height: '220px',
                        background: '#e5e7eb',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#6b7280',
                        fontSize: '14px',
                    }}
                >
                    Фото буде тут
                </div>

                {/* Описание */}
                <div style={{ fontSize: '15px', lineHeight: 1.6 }}>
                    {ad.description ?? 'Опис відсутній'}
                </div>

                {/* Действия */}
                <div className="stack8">
                    <button className="btn-primary">
                        Написати автору
                    </button>

                    <button
                        className="btn-secondary"
                        onClick={() => alert('Скаргу надіслано адміністратору')}
                    >
                        Поскаржитись
                    </button>
                    <button
                        style={{
                            width: '100%',
                            background: '#fee2e2',
                            color: '#991b1b',
                            border: 'none',
                            padding: '10px',
                            borderRadius: '10px',
                            fontSize: '14px',
                            cursor: 'pointer',
                        }}
                        onClick={() => alert('Скаргу буде розглянуто модератором')}
                    >
                        🚨 Поскаржитись на оголошення
                    </button>

                </div>
            </div>
        </div>
    )
}

export default AdDetailsPage
