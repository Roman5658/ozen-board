import { useNavigate } from "react-router-dom"
import auctionIcon from "../img/3366116.png"

type Props = {
    activePath: string
    chatUnreadCount: number
    t: {
        home: string
        nearby: string
        add: string
        auctions: string
        account: string
    }
}


function BottomNav({ activePath, chatUnreadCount, t }: Props) {
    const navigate = useNavigate()
    const badgeText = chatUnreadCount > 99 ? "99+" : String(chatUnreadCount)

    const items = [
        { path: "/", label: t.home, icon: "📋", type: "emoji" },
        { path: "/nearby", label: t.nearby, icon: "📍", type: "emoji" },
        { path: "/add", label: t.add, icon: "➕", type: "emoji" },
        { path: "/auctions", label: t.auctions, icon: auctionIcon, type: "image" },
        { path: "/account", label: t.account, icon: "👤", type: "emoji" },
    ] as const




    return (
        <div className="bottom-nav-wrap">
            <nav className="bottom-nav" aria-label="Bottom navigation">
                {items.map((item) => (
                    <button
                        key={item.path}
                        onClick={() => navigate(item.path)}
                        className={`nav-button ${activePath === item.path ? "active" : ""}`}
                    >
                        {item.type === "emoji" ? (
                            <span className="nav-icon" style={{ position: "relative" }}>
                                {item.icon}
                                {item.path === "/account" && chatUnreadCount > 0 && (
                                    <span
                                        style={{
                                            position: "absolute",
                                            top: -8,
                                            right: -12,
                                            minWidth: 18,
                                            height: 18,
                                            padding: "0 4px",
                                            borderRadius: 999,
                                            background: "#dc2626",
                                            color: "#fff",
                                            fontSize: 10,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            border: "2px solid #fff",
                                        }}
                                    >
                                        {badgeText}
                                    </span>
                                )}
                            </span>
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
