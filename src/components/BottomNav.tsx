import { useNavigate } from 'react-router-dom'

type Props = {
    activePath: string
}

function BottomNav({ activePath }: Props) {
    const navigate = useNavigate()

    const items = [
        { path: '/', label: 'Оголошення' },
        { path: '/nearby', label: 'Поруч' },
        { path: '/add', label: 'Додати' },
        { path: '/auctions', label: 'Аукціон' },
        { path: '/account', label: 'Акаунт' },
    ]

    return (
        <nav className="bottom-nav">
            {items.map(item => (
                <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className={activePath === item.path ? 'active' : ''}
                >
                    {item.label}
                </button>
            ))}
        </nav>
    )
}

export default BottomNav
