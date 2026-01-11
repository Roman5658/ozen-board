import type { ReactNode } from 'react'
import BottomNav from '../components/BottomNav'
import Footer from '../components/Footer'


type Props = {
    children: ReactNode
    header: ReactNode
    activePath: string
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
            cookies: string
            contact: string
        }
    }
}


function AppLayout({ children, header, activePath, t }: Props) {
    return (
        <div className="app-root">
            {header}

            <main className="app-main">
                {children}
            </main>
            <Footer t={t.footer} />

            <BottomNav
                activePath={activePath}
                t={t.bottomNav}
            />


        </div>
    )
}

export default AppLayout
