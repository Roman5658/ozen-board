import { useState } from 'react'
import { getLocalUser, setLocalUser, clearLocalUser } from '../data/localUser'
import { getLocalAds, removeLocalAd } from '../data/localAds'
import AdCard from '../components/AdCard'
import { Link } from 'react-router-dom'

function AccountPage() {
    const user = getLocalUser()
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')

    // ---------- РЕГИСТРАЦІЯ ----------
    if (!user) {
        return (
            <div className="card stack12">
                <h2 className="h2">Реєстрація</h2>

                <input
                    className="input"
                    placeholder="Імʼя"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />

                <input
                    className="input"
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />

                <button
                    className="btn-primary"
                    disabled={!name.trim() || !email.includes('@')}
                    onClick={() => {
                        setLocalUser({
                            id: Date.now(),
                            name: name.trim(),
                            email: email.trim().toLowerCase(),
                            karma: 0,
                            createdAt: Date.now(),
                        })
                        window.location.reload()
                    }}
                >
                    Створити акаунт
                </button>

                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                    Email буде використовуватись для захисту акаунту
                </div>
            </div>
        )
    }

    // ✅ ТЕПЕР user гарантовано є
    const myAds = getLocalAds().filter(ad => ad.userId === String(user.id))


    // ---------- ПРОФІЛЬ ----------
    return (
        <div className="stack12">
            {/* Профіль */}
            <div className="card stack8">
                <h2 className="h2">{user.name}</h2>
                <div style={{ fontSize: '14px', color: '#6b7280' }}>
                    {user.email}
                </div>
                <div>Карма: {user.karma}</div>

                <button
                    className="btn-secondary"
                    onClick={() => {
                        clearLocalUser()
                        window.location.reload()
                    }}
                >
                    Вийти
                </button>
            </div>

            {/* Мої оголошення */}
            <div className="card stack12">
                <h3 className="h3">Мої оголошення</h3>

                {myAds.length === 0 ? (
                    <div style={{ color: '#6b7280', fontSize: '14px' }}>
                        Ви ще не додали жодного оголошення
                    </div>
                ) : (
                    <div className="stack12">
                        {myAds.map(ad => (
                            <div key={ad.id} className="stack8">
                                <Link
                                    to={`/ad/${ad.id}`}
                                    style={{ textDecoration: 'none', color: 'inherit' }}
                                >
                                    <AdCard
                                        title={ad.title}
                                        city={ad.city}
                                        price={ad.price}
                                        description={ad.description}
                                        image={ad.image}
                                        isPremium={ad.isPremium}
                                    />
                                </Link>

                                <button
                                    style={{
                                        background: '#fee2e2',
                                        color: '#991b1b',
                                        border: 'none',
                                        padding: '8px',
                                        borderRadius: '10px',
                                        fontSize: '13px',
                                        cursor: 'pointer',
                                    }}
                                    onClick={() => {
                                        removeLocalAd(ad.id)
                                        window.location.reload()
                                    }}
                                >
                                    Видалити
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default AccountPage
