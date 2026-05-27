import { type ReactNode } from 'react'
import BottomNav from '../components/BottomNav'
import Footer from '../components/Footer'


type Props = {
    children: ReactNode
    header: ReactNode
    activePath: string
    chatUnreadCount: number
    t: {
        bottomNav: {
            home: string
            nearby: string
            add: string
            auctions: string
            account: string
        }
        footer: {
            privacy: string
            terms: string
            safety: string
            cookies: string
            contact: string
        }
        trustBanner: {
            line1: string
            line2: string
        }
    }
}


function AppLayout({ children, header, activePath, chatUnreadCount, t }: Props) {

    return (
        <div className="app-root">
            {header}

            <div className="trust-banner" role="note">
                <span className="trust-banner__icon" aria-hidden="true">✓</span>
                <span className="trust-banner__text">
                    <span>{t.trustBanner.line1}</span>
                    <span>{t.trustBanner.line2}</span>
                </span>
            </div>

            <main className="app-main">
                {children}
            </main>
            <Footer t={t.footer}/>

            <BottomNav
                activePath={activePath}
                chatUnreadCount={chatUnreadCount}
                t={t.bottomNav}
            />
        </div>
    )
}

export default AppLayout
