import type { ReactNode } from 'react'
import BottomNav from '../components/BottomNav'
import Footer from '../components/Footer'


type Props = {
    children: ReactNode
    header: ReactNode
    activePath: string
}

function AppLayout({ children, header, activePath }: Props) {
    return (
        <div className="app-root">
            {header}

            <main className="app-main">
                {children}
            </main>
            <Footer />
            <BottomNav activePath={activePath} />

            <BottomNav activePath={activePath} />
        </div>
    )
}

export default AppLayout
