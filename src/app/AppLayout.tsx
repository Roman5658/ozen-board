import type { ReactNode } from 'react'
import BottomNav from '../components/BottomNav'

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

            <BottomNav activePath={activePath} />
        </div>
    )
}

export default AppLayout
