import { useNavigate } from "react-router-dom"
import auctionIcon from "../img/3366116.png"

type Props = {
    activePath: string
    collapsed: boolean
    onToggle: () => void
    t: {
        home: string
        nearby: string
        add: string
        auctions: string
        account: string
    }
}


function BottomNav({ activePath, collapsed, onToggle, t }: Props) {
    const navigate = useNavigate()

    const items = [
        { path: "/", label: t.home, icon: "📋", type: "emoji" },
        { path: "/nearby", label: t.nearby, icon: "📍", type: "emoji" },
        { path: "/add", label: t.add, icon: "➕", type: "emoji" },
        { path: "/auctions", label: t.auctions, icon: auctionIcon, type: "image" },
        { path: "/account", label: t.account, icon: "👤", type: "emoji" },
    ] as const




    return (
        <div className="bottom-nav-wrap">
            <button
                type="button"
                className="bottom-nav-toggle"
                onClick={onToggle}
                aria-expanded={!collapsed}
                aria-controls="bottom-nav-panel"
            >
                {collapsed ? "☰ Меню" : "✕ Закрыть"}
            </button>


            <nav
                id="bottom-nav-panel"
                className={`bottom-nav ${collapsed ? "is-collapsed" : ""}`}
                aria-hidden={collapsed}
            >
                {items.map((item) => (
            <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`nav-button ${activePath === item.path ? "active" : ""}`}
            >
                {item.type === "emoji" ? (
                    <span className="nav-icon">{item.icon}</span>
                ) : (
                    <img src={item.icon} alt={item.label} className="nav-icon-img"/>
                )}


                <span className="nav-label">{item.label}</span>
            </button>

                ))}
            </nav>
        </div>
    )
}

export default BottomNav
