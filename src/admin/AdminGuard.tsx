import { Navigate } from "react-router-dom"
import { isAdmin } from "../data/localUser"

type Props = {
    children: React.ReactNode
}

export default function AdminGuard({ children }: Props) {
    if (!isAdmin()) {
        return <Navigate to="/" replace />
    }

    return <>{children}</>
}
