import { useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'

import { translations, DEFAULT_LANG } from './i18n'
import type { Lang } from './i18n'

import HomePage from '../pages/HomePage'
import NearbyPage from '../pages/NearbyPage'
import AddPage from '../pages/AddPage'
import AuctionPage from '../pages/AuctionPage'
import AccountPage from '../pages/AccountPage'
import AdDetailsPage from '../pages/AdDetailsPage'

import Header from '../components/Header'
import AppLayout from './AppLayout'

function App() {
    const [lang, setLang] = useState<Lang>(() => {
        const saved = localStorage.getItem('lang')
        return (saved as Lang) || DEFAULT_LANG
    })

    const t = translations[lang]
    const location = useLocation()

    function changeLang(next: Lang) {
        setLang(next)
        localStorage.setItem('lang', next)
    }

    return (
        <AppLayout
            activePath={location.pathname}
            header={
                <Header
                    title={t.title}
                    subtitle={t.subtitle}
                    warning={t.warning}
                    lang={lang}
                    onLangChange={changeLang}
                />
            }
        >
            <Routes>
                <Route path="/" element={<HomePage t={t} />} />
                <Route path="/nearby" element={<NearbyPage t={t} />} />

                <Route path="/add" element={<AddPage />} />
                <Route path="/auction" element={<AuctionPage />} />
                <Route path="/account" element={<AccountPage />} />

                <Route path="/ad/:id" element={<AdDetailsPage />} />
            </Routes>

        </AppLayout>
    )
}

export default App
