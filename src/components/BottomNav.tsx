import { useNavigate } from "react-router-dom"
import auctionIcon from "../img/3366116.png"

type Props = {
    activePath: string
}

function BottomNav({ activePath }: Props) {
    const navigate = useNavigate()

    const items = [
        { path: "/", label: "Оголошення", icon: "📋", type: "emoji" },
        { path: "/nearby", label: "Поруч", icon: "📍", type: "emoji" },
        { path: "/add", label: "Додати", icon: "➕", type: "emoji" },
        { path: "/auctions", label: "Аукціон", icon: auctionIcon, type: "image" },
        { path: "/account", label: "Акаунт", icon: "👤", type: "emoji" },
    ]



    return (
        <nav className="bottom-nav">
            {items.map(item => {


                return (
                    <button
                        key={item.path}
                        onClick={() => navigate(item.path)}
                        className={`nav-button ${activePath === item.path ? "active" : ""}`}
                    >
                        {item.type === "emoji" ? (
                            <span className="nav-icon">{item.icon}</span>
                        ) : (
                            <img
                                src={item.icon}
                                alt={item.label}
                                className="nav-icon-img"
                            />
                        )}


                        <span className="nav-label">{item.label}</span>
                    </button>

                )
            })}
        </nav>
    )
}

export default BottomNav
