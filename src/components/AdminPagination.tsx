import type { PaginationLabels } from "../utils/adminPagination"

type AdminPaginationProps = {
    page: number
    pageSize: number
    totalItems: number
    labels: PaginationLabels
    onPageChange: (page: number) => void
}

export default function AdminPagination({
    page,
    pageSize,
    totalItems,
    labels,
    onPageChange,
}: AdminPaginationProps) {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    function scrollToPageTop() {
        const scroll = () => {
            const options: ScrollToOptions = { top: 0, behavior: "smooth" }
            window.scrollTo(options)
            document.scrollingElement?.scrollTo(options)
            document.querySelector<HTMLElement>(".app-main")?.scrollTo(options)
        }

        window.requestAnimationFrame(() => {
            scroll()
            window.setTimeout(scroll, 0)
        })
    }

    function goToPage(nextPage: number) {
        const safePage = Math.min(Math.max(nextPage, 1), totalPages)
        onPageChange(safePage)
        scrollToPageTop()
    }

    if (totalItems <= pageSize) {
        return (
            <div style={{ color: "#6b7280", fontSize: 13 }}>
                {labels.count(totalItems)}
            </div>
        )
    }

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
                color: "#4b5563",
                fontSize: 13,
            }}
        >
            <div>
                {labels.count(totalItems)} · {labels.page(page, totalPages)}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                    type="button"
                    className="btn-secondary"
                    disabled={page <= 1}
                    onClick={() => goToPage(page - 1)}
                    style={{ width: "fit-content" }}
                >
                    {labels.previous}
                </button>
                <button
                    type="button"
                    className="btn-secondary"
                    disabled={page >= totalPages}
                    onClick={() => goToPage(page + 1)}
                    style={{ width: "fit-content" }}
                >
                    {labels.next}
                </button>
            </div>
        </div>
    )
}
