import { Outlet, NavLink } from "react-router-dom"
import AdminGuard from "./AdminGuard"


export default function AdminLayout() {
    return (
        <AdminGuard>
            <div style={{ display: "flex", minHeight: "100vh" }}>
                <aside
                    style={{
                        width: 220,
                        padding: 16,
                        borderRight: "1px solid #e5e7eb",
                        background: "#fafafa",
                    }}
                >
                    <h3>Admin</h3>

                    <nav style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <NavLink to="/admin/ads">Оголошення</NavLink>
                        <NavLink to="/admin/auctions">Аукціони</NavLink>
                        <NavLink to="/admin/reports">Скарги</NavLink>
                        <NavLink to="/admin/payments">Платежі</NavLink>
                        <NavLink to="/admin/ads">Черги</NavLink>
                        <NavLink to="/admin/ads/list">Усі оголошення</NavLink>

                    </nav>
                </aside>

                <main style={{ flex: 1, padding: 16 }}>
                    <Outlet />
                </main>
            </div>
        </AdminGuard>
    )
}
