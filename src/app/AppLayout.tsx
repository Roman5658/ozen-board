import { useEffect, useState, type ReactNode } from 'react'
import BottomNav from '../components/BottomNav'
import Footer from '../components/Footer'

const BOTTOM_NAV_STORAGE_KEY = 'bottomNavCollapsed'
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
    const [isBottomNavCollapsed, setIsBottomNavCollapsed] = useState<boolean>(() => {
        const storedValue = localStorage.getItem(BOTTOM_NAV_STORAGE_KEY)
        return storedValue === null ? true : storedValue === 'true'
    })

    useEffect(() => {
        localStorage.setItem(BOTTOM_NAV_STORAGE_KEY, String(isBottomNavCollapsed))
    }, [isBottomNavCollapsed])
    return (
        <div className={`app-root ${isBottomNavCollapsed ? 'bottom-nav-collapsed' : 'bottom-nav-open'}`}>
            {header}

            <main className="app-main">
                {children}
            </main>
            <Footer t={t.footer}/>

            <BottomNav
                activePath={activePath}
                collapsed={isBottomNavCollapsed}
                onToggle={() => setIsBottomNavCollapsed((prev) => !prev)}
                t={t.bottomNav}
            />


        </div>
    )
}

export default AppLayout
