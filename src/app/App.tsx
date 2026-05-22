import { useState } from 'react'
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import AdminReportsPage from "../pages/AdminReportsPage"
import AddAuctionPage from '../pages/AddAuctionPage'
import UserPage from '../pages/UserPage'
import ChatPage from "../pages/ChatPage"
// import PayTestPage from "../pages/PayTestPage"
import PrivacyPage from '../pages/PrivacyPage'
import TermsPage from '../pages/TermsPage'
import CookiesPage from '../pages/CookiesPage'
import ContactPage from '../pages/ContactPage'
import AdminLayout from "../admin/AdminLayout"
import AdminAdsPage from "../pages/AdminAdsPage"
import AdminAdsListPage from "../pages/AdminAdsListPage"
import AdminAdDetailsPage from "../pages/AdminAdDetailsPage"

import { translations, detectInitialLang } from './i18n'


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
import { useSeo, BASE_URL } from '../utils/seo'
import EditAuctionPage from '../pages/EditAuctionPage'
import AdminPaymentsPage from "../pages/AdminPaymentsPage"
import AdminAuctionsPage from "../pages/AdminAuctionsPage"

function App() {
    const [lang, setLang] = useState<Lang>(() => detectInitialLang())


    const t = translations[lang]
    const location = useLocation()
    const navigate = useNavigate()
    useSeo({
        title: t.seo.appTitle,
        description: t.seo.appDescription,
        path: location.pathname,
        lang: lang,
        alternates: [
            { hreflang: 'pl-PL', href: `${BASE_URL}/pl/` },
            { hreflang: 'uk-UA', href: `${BASE_URL}/uk/` },
            { hreflang: 'x-default', href: `${BASE_URL}/pl/` },
        ],
        jsonLd: [
            {
                '@context': 'https://schema.org',
                '@type': 'WebSite',
                name: 'Xoven',
                url: BASE_URL,
                inLanguage: ['pl-PL', 'uk-UA'],
                potentialAction: {
                    '@type': 'SearchAction',
                    target: `${BASE_URL}/${lang}/ogloszenia?q={search_term_string}`,
                    'query-input': 'required name=search_term_string',
                },
            },
            {
                '@context': 'https://schema.org',
                '@type': 'Organization',
                name: 'Xoven',
                url: BASE_URL,
                logo: `${BASE_URL}/vite.svg`,
            },
        ],
    })


    function changeLang(next: Lang) {
        setLang(next)
        localStorage.setItem('lang', next)
        navigate(`/${next}/`)
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
                    languages={t.languages}
                    onLangChange={changeLang}

                />

            }
            t={t}
        >
            <Routes>
                <Route path="/" element={<Navigate to={`/${lang}/`} replace />} />
                <Route path="/pl" element={<Navigate to="/pl/" replace />} />
                <Route path="/uk" element={<Navigate to="/uk/" replace />} />
                <Route path="/pl/" element={<HomePage t={translations.pl} />} />
                <Route path="/pl/ogloszenia" element={<HomePage t={translations.pl} />} />
                <Route path="/pl/uslugi" element={<HomePage t={translations.pl} />} />
                <Route path="/pl/wynajem" element={<HomePage t={translations.pl} />} />
                <Route path="/uk/" element={<HomePage t={translations.uk} />} />
                <Route path="/uk/ogoloshennya" element={<HomePage t={translations.uk} />} />
                <Route path="/uk/poslugy" element={<HomePage t={translations.uk} />} />
                <Route path="/uk/orenda" element={<HomePage t={translations.uk} />} />
                <Route path="/nearby" element={<NearbyPage t={t} />} />

                <Route path="/add-auction" element={<AddAuctionPage t={t} />} />
                <Route path="/user/:id" element={<UserPage />} />
                <Route path="/chat/:id" element={<ChatPage />} />
                {/*<Route path="/pay-test" element={<PayTestPage />} />*/}
                <Route path="/terms" element={<TermsPage t={t} />} />
                <Route path="/cookies" element={<CookiesPage t={t} />} />
                <Route path="/contact" element={<ContactPage t={t} />} />
                <Route path="/edit/:id" element={<EditAdPage />} />
                <Route path="/edit-auction/:id" element={<EditAuctionPage />} />
                <Route path="/privacy" element={<PrivacyPage t={t} />} />

                <Route path="/add" element={<AddPage t={t} />} />
                <Route path="/account" element={<AccountPage t={t} />} />
                <Route path="/my-ads" element={<MyAdsPage />} />

                {/* Аукционы */}
                <Route path="/auctions" element={<AuctionPage  />} />
                <Route path="/auction/:id" element={<AuctionPage />} />
                <Route path="/pl/aukcje" element={<AuctionPage />} />
                <Route path="/uk/auktsiony" element={<AuctionPage />} />

                {/* Обычные объявления */}
                <Route path="/ad/:id" element={<AdDetailsPage t={t} />} />

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
