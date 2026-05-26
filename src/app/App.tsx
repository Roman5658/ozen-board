import { useEffect, useState } from 'react'
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import AdminReportsPage from "../pages/AdminReportsPage"
import AddAuctionPage from '../pages/AddAuctionPage'
import UserPage from '../pages/UserPage'
import ChatPage from "../pages/ChatPage"
// import PayTestPage from "../pages/PayTestPage"
import PrivacyPage from '../pages/PrivacyPage'
import TermsPage from '../pages/TermsPage'
import SafetyPage from '../pages/SafetyPage'
import CookiesPage from '../pages/CookiesPage'
import ContactPage from '../pages/ContactPage'
import PromotionInfoPage from '../pages/PromotionInfoPage'
import AdminLayout from "../admin/AdminLayout"
import AdminAdsPage from "../pages/AdminAdsPage"
import AdminAdsListPage from "../pages/AdminAdsListPage"
import AdminAdDetailsPage from "../pages/AdminAdDetailsPage"

import { translations, detectInitialLang } from './i18n'
import { getLocalUser, LOCAL_USER_CHANGED_EVENT } from '../data/localUser'
import { getUnreadCountForUser, subscribeToUserChats } from '../data/chats'


import type { Lang } from './i18n'
import MyAdsPage from '../pages/MyAdsPage'
import EditAdPage from '../pages/EditAdPage'

import HomePage from '../pages/HomePage'
import NearbyPage from '../pages/NearbyPage'
import AddPage from '../pages/AddPage'
import AuctionPage from '../pages/AuctionPage'
import AccountPage from '../pages/AccountPage'
import AccountChatsPage from '../pages/AccountChatsPage'
import AccountPaymentsPage from '../pages/AccountPaymentsPage'
import AdDetailsPage from '../pages/AdDetailsPage'

import Header from '../components/Header'
import AppLayout from './AppLayout'
import { useSeo, BASE_URL } from '../utils/seo'
import EditAuctionPage from '../pages/EditAuctionPage'
import AdminPaymentsPage from "../pages/AdminPaymentsPage"
import AdminAuctionsPage from "../pages/AdminAuctionsPage"
import AdminUsersPage from "../pages/AdminUsersPage"

function App() {
    const [lang, setLang] = useState<Lang>(() => detectInitialLang())
    const [currentUser, setCurrentUser] = useState(() => getLocalUser())
    const [chatUnreadCount, setChatUnreadCount] = useState(0)


    const t = translations[lang]
    const location = useLocation()
    const navigate = useNavigate()
    const noindexPrefixes = ['/admin', '/account', '/my-ads', '/add', '/edit', '/chat']
    const noindex = noindexPrefixes.some((prefix) => location.pathname.startsWith(prefix))
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
        noindex,
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

    useEffect(() => {
        function syncLocalUser() {
            setCurrentUser(getLocalUser())
        }

        window.addEventListener(LOCAL_USER_CHANGED_EVENT, syncLocalUser)
        window.addEventListener('storage', syncLocalUser)

        return () => {
            window.removeEventListener(LOCAL_USER_CHANGED_EVENT, syncLocalUser)
            window.removeEventListener('storage', syncLocalUser)
        }
    }, [])

    useEffect(() => {
        if (!currentUser) {
            setChatUnreadCount(0)
            return
        }

        const userIds = [currentUser.id, currentUser.uid, currentUser.email].filter(Boolean)
        return subscribeToUserChats(currentUser.id, currentUser.uid, (chats) => {
            setChatUnreadCount(
                chats.reduce((sum, chat) => sum + getUnreadCountForUser(chat, userIds), 0)
            )
        })
    }, [currentUser])

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
                    chatUnreadCount={chatUnreadCount}
                    chatLabel={t.chatIndicator.label}
                    onLangChange={changeLang}

                />

            }
            t={t}
            chatUnreadCount={chatUnreadCount}
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
                <Route path="/safety" element={<SafetyPage t={t} />} />
                <Route path="/pl/bezpieczenstwo" element={<SafetyPage t={translations.pl} />} />
                <Route path="/uk/bezpeka" element={<SafetyPage t={translations.uk} />} />
                <Route path="/promotion-info" element={<PromotionInfoPage t={t} />} />
                <Route path="/edit/:id" element={<EditAdPage />} />
                <Route path="/edit-auction/:id" element={<EditAuctionPage />} />
                <Route path="/privacy" element={<PrivacyPage t={t} />} />

                <Route path="/add" element={<AddPage t={t} />} />
                <Route path="/account" element={<AccountPage t={t} chatUnreadCount={chatUnreadCount} />} />
                <Route path="/account/chats" element={<AccountChatsPage t={t} />} />
                <Route path="/account/payments" element={<AccountPaymentsPage t={t} />} />
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
                    <Route path="reports" element={<AdminReportsPage t={t} />} />
                    <Route path="users" element={<AdminUsersPage t={t} />} />
                    <Route path="payments" element={<AdminPaymentsPage />} />
                </Route>
            </Routes>





        </AppLayout>
    )
}

export default App
