import { Outlet, NavLink } from "react-router-dom"
import AdminGuard from "./AdminGuard"


export default function AdminLayout() {
    return (
        <AdminGuard>
            <div className="admin-layout">
                <aside className="admin-sidebar">
                    <h3 className="admin-sidebar__title">Admin</h3>

                    <nav className="admin-nav">
                        <NavLink to="/admin/ads">Оголошення</NavLink>
                        <NavLink to="/admin/auctions">Аукціони</NavLink>
                        <NavLink to="/admin/reports">Скарги</NavLink>
                        <NavLink to="/admin/users">Користувачі</NavLink>
                        <NavLink to="/admin/payments">Платежі</NavLink>
                        <NavLink to="/admin/backups">Резервні копії</NavLink>
                        <NavLink to="/admin/leads">Lead Manager</NavLink>
                        <NavLink to="/admin/ads">Черги</NavLink>
                        <NavLink to="/admin/ads/list">Усі оголошення</NavLink>

                    </nav>
                </aside>

                <main className="admin-content">
                    <Outlet />
                </main>
            </div>
        </AdminGuard>
    )
}
