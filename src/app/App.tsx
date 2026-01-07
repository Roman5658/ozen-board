import { useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import AdminReportsPage from "../pages/AdminReportsPage"
import AddAuctionPage from '../pages/AddAuctionPage'
import UserPage from '../pages/UserPage'
import ChatPage from "../pages/ChatPage"
import PayTestPage from "../pages/PayTestPage"
import PrivacyPage from '../pages/PrivacyPage'
import TermsPage from '../pages/TermsPage'
import CookiesPage from '../pages/CookiesPage'
import ContactPage from '../pages/ContactPage'
import AdminLayout from "../admin/AdminLayout"
import AdminAdsPage from "../pages/AdminAdsPage"
import AdminAdsListPage from "../pages/AdminAdsListPage"
import AdminAdDetailsPage from "../pages/AdminAdDetailsPage"

import { translations, DEFAULT_LANG } from './i18n'
import type { Lang } from './i18n'
import MyAdsPage from '../pages/MyAdsPage'
import EditAdPage from '../pages/EditAdPage'

import HomePage from '../pages/HomePage'
import NearbyPage from '../pages/NearbyPage'
import AddPage from '../pages/AddPage'
import AuctionPage from '../pages/AuctionPage'
import AccountPage from '../pages/AccountPage'
import AdDetailsPage from '../pages/AdDetailsPage'

import Header from '../components/Header'
import AppLayout from './AppLayout'
import EditAuctionPage from '../pages/EditAuctionPage'
import AdminPaymentsPage from "../pages/AdminPaymentsPage"
import AdminAuctionsPage from "../pages/AdminAuctionsPage"
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

                <Route path="/add-auction" element={<AddAuctionPage />} />
                <Route path="/user/:id" element={<UserPage />} />
                <Route path="/chat/:id" element={<ChatPage />} />
                <Route path="/pay-test" element={<PayTestPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/cookies" element={<CookiesPage />} />
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/edit/:id" element={<EditAdPage />} />
                <Route path="/edit-auction/:id" element={<EditAuctionPage />} />


                <Route path="/add" element={<AddPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/my-ads" element={<MyAdsPage />} />

                {/* Аукционы */}
                <Route path="/auctions" element={<AuctionPage />} />
                <Route path="/auction/:id" element={<AuctionPage />} />


                {/* Обычные объявления */}
                <Route path="/ad/:id" element={<AdDetailsPage />} />

                <Route path="/admin/*" element={<AdminLayout />}>
                    <Route path="ads/:adId" element={<AdminAdDetailsPage />} />

                    <Route path="ads/list" element={<AdminAdsListPage />} />
                    <Route path="ads" element={<AdminAdsPage />} />
                    <Route path="auctions" element={<AdminAuctionsPage />} />
                    <Route path="reports" element={<AdminReportsPage />} />
                    <Route path="payments" element={<AdminPaymentsPage />} />
                </Route>
            </Routes>





        </AppLayout>
    )
}

export default App
