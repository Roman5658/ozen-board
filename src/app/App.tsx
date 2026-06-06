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
import AdminBackupPage from "../pages/AdminBackupPage"

function getAppSeo(pathname: string, lang: Lang, t: (typeof translations)[Lang]) {
    const homeAlternates = [
        { hreflang: 'pl-PL', href: `${BASE_URL}/pl/` },
        { hreflang: 'uk-UA', href: `${BASE_URL}/uk/` },
        { hreflang: 'x-default', href: `${BASE_URL}/pl/` },
    ]

    const safetyAlternates = [
        { hreflang: 'pl-PL', href: `${BASE_URL}/pl/bezpieczenstwo` },
        { hreflang: 'uk-UA', href: `${BASE_URL}/uk/bezpeka` },
        { hreflang: 'x-default', href: `${BASE_URL}/pl/bezpieczenstwo` },
    ]

    const staticSeo: Record<string, { title: string; description: string; alternates?: typeof homeAlternates }> = {
        '/privacy': {
            title: lang === 'pl' ? 'Polityka prywatności | Xoven' : 'Політика конфіденційності | Xoven',
            description: lang === 'pl' ? 'Jak Xoven przetwarza dane użytkowników, płatności, profile, czaty i cookies.' : 'Як Xoven обробляє дані користувачів, платежі, профілі, чати та cookies.',
        },
        '/terms': {
            title: lang === 'pl' ? 'Regulamin | Xoven' : 'Умови користування | Xoven',
            description: lang === 'pl' ? 'Zasady korzystania z Xoven, promowania, aukcji, moderacji i bezpieczeństwa.' : 'Правила користування Xoven, просування, аукціонів, модерації та безпеки.',
        },
        '/cookies': {
            title: lang === 'pl' ? 'Cookies | Xoven' : 'Cookies | Xoven',
            description: lang === 'pl' ? 'Informacje o cookies i localStorage używanych przez Xoven.' : 'Інформація про cookies і localStorage, які використовує Xoven.',
        },
        '/contact': {
            title: lang === 'pl' ? 'Kontakt | Xoven' : 'Контакти | Xoven',
            description: lang === 'pl' ? 'Kontakt z zespołem Xoven w sprawach platformy, bezpieczeństwa i prywatności.' : 'Контакт з командою Xoven щодо платформи, безпеки та приватності.',
        },
        '/promotion-info': {
            title: lang === 'pl' ? 'Jak działa promowanie? | Xoven' : 'Як працює просування? | Xoven',
            description: lang === 'pl' ? 'Informacje o promowaniu ogłoszeń i aukcji, płatnościach oraz zasadach widoczności.' : 'Інформація про просування оголошень і аукціонів, оплату та правила видимості.',
        },
        '/safety': {
            title: lang === 'pl' ? 'Bezpieczeństwo | Xoven' : 'Безпека | Xoven',
            description: lang === 'pl' ? 'Zasady bezpiecznych transakcji online i ochrony przed oszustwami na Xoven.' : 'Правила безпечних онлайн-угод і захисту від шахрайства на Xoven.',
            alternates: safetyAlternates,
        },
        '/pl/bezpieczenstwo': {
            title: 'Bezpieczeństwo | Xoven',
            description: 'Zasady bezpiecznych transakcji online i ochrony przed oszustwami na Xoven.',
            alternates: safetyAlternates,
        },
        '/uk/bezpeka': {
            title: 'Безпека | Xoven',
            description: 'Правила безпечних онлайн-угод і захисту від шахрайства на Xoven.',
            alternates: safetyAlternates,
        },
    }

    return staticSeo[pathname] ?? {
        title: t.seo.appTitle,
        description: t.seo.appDescription,
        alternates: homeAlternates,
    }
}

function App() {
    const [lang, setLang] = useState<Lang>(() => detectInitialLang())
    const [currentUser, setCurrentUser] = useState(() => getLocalUser())
    const [chatUnreadCount, setChatUnreadCount] = useState(0)


    const t = translations[lang]
    const location = useLocation()
    const navigate = useNavigate()
    const noindexPrefixes = ['/admin', '/account', '/my-ads', '/add', '/edit', '/chat']
    const noindex = noindexPrefixes.some((prefix) => location.pathname.startsWith(prefix))
    const hasDedicatedDetailSeo =
        location.pathname.startsWith('/ad/') ||
        location.pathname.startsWith('/auction/')
    const appSeo = getAppSeo(location.pathname, lang, t)
    useSeo({
        title: appSeo.title,
        description: appSeo.description,
        path: location.pathname,
        lang: lang,
        enabled: !hasDedicatedDetailSeo,
        alternates: appSeo.alternates,
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
                    target: `${BASE_URL}/${lang === 'pl' ? 'pl/ogloszenia' : 'uk/ogoloshennya'}?q={search_term_string}`,
                    'query-input': 'required name=search_term_string',
                },
            },
            {
                '@context': 'https://schema.org',
                '@type': 'Organization',
                name: 'Xoven',
                url: BASE_URL,
                logo: `${BASE_URL}/apple-touch-icon.png`,
            },
        ],
    })


    function getLocalizedPath(pathname: string, next: Lang): string {
        const routes: Record<Lang, Record<string, string>> = {
            pl: {
                '/uk': '/pl',
                '/uk/': '/pl/',
                '/uk/ogoloshennya': '/pl/ogloszenia',
                '/uk/poslugy': '/pl/uslugi',
                '/uk/orenda': '/pl/wynajem',
                '/uk/auktsiony': '/pl/aukcje',
                '/uk/bezpeka': '/pl/bezpieczenstwo',
            },
            uk: {
                '/pl': '/uk',
                '/pl/': '/uk/',
                '/pl/ogloszenia': '/uk/ogoloshennya',
                '/pl/uslugi': '/uk/poslugy',
                '/pl/wynajem': '/uk/orenda',
                '/pl/aukcje': '/uk/auktsiony',
                '/pl/bezpieczenstwo': '/uk/bezpeka',
            },
        }

        if (routes[next][pathname]) return routes[next][pathname]
        if (pathname === '/') return `/${next}/`
        if (pathname.startsWith('/pl/') || pathname.startsWith('/uk/')) return `/${next}/`
        return pathname
    }

    function changeLang(next: Lang) {
        setLang(next)
        localStorage.setItem('lang', next)
        navigate(`${getLocalizedPath(location.pathname, next)}${location.search}${location.hash}`, { replace: true })
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
                    <Route path="backups" element={<AdminBackupPage />} />
                </Route>
            </Routes>





        </AppLayout>
    )
}

export default App
