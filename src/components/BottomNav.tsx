import { useNavigate } from "react-router-dom"

type Props = {
    activePath: string
}

function BottomNav({ activePath }: Props) {
    const navigate = useNavigate()

    const items = [
        { path: "/", label: "Оголошення", icon: "📄" },
        { path: "/nearby", label: "Поруч", icon: "📍" },
        { path: "/add", label: "Додати", icon: "➕" },
        { path: "/auctions", label: "Аукціон", icon: "🔨" },
        { path: "/account", label: "Акаунт", icon: "👤" },
    ]

    return (
        <nav className="bottom-nav">
            {items.map(item => {
                const isActive = activePath === item.path

                return (
                    <button
                        key={item.path}
                        onClick={() => navigate(item.path)}
                        className={`bottom-nav-item ${isActive ? "active" : ""}`}
                    >
                        <span className="nav-icon">{item.icon}</span>
                        <span className="nav-label">{item.label}</span>
                    </button>
                )
            })}
        </nav>
    )
}

export default BottomNav
