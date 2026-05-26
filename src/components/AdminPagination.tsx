type PaginationLabels = {
    previous: string
    next: string
    page: (page: number, totalPages: number) => string
    count: (totalItems: number) => string
}

type AdminPaginationProps = {
    page: number
    pageSize: number
    totalItems: number
    labels: PaginationLabels
    onPageChange: (page: number) => void
}

export function getTotalPages(totalItems: number, pageSize: number) {
    return Math.max(1, Math.ceil(totalItems / pageSize))
}

export function paginateItems<T>(items: T[], page: number, pageSize: number) {
    const start = (page - 1) * pageSize
    return items.slice(start, start + pageSize)
}

export function getAdminPaginationLabels(lang: "uk" | "pl"): PaginationLabels {
    return lang === "pl"
        ? {
            previous: "Wstecz",
            next: "Dalej",
            page: (page, totalPages) => `Strona ${page} z ${totalPages}`,
            count: (totalItems) => `Znaleziono: ${totalItems}`,
        }
        : {
            previous: "Назад",
            next: "Далі",
            page: (page, totalPages) => `Сторінка ${page} з ${totalPages}`,
            count: (totalItems) => `Знайдено: ${totalItems}`,
        }
}

export default function AdminPagination({
    page,
    pageSize,
    totalItems,
    labels,
    onPageChange,
}: AdminPaginationProps) {
    const totalPages = getTotalPages(totalItems, pageSize)
    function goToPage(nextPage: number) {
        const safePage = Math.min(Math.max(nextPage, 1), totalPages)
        onPageChange(safePage)
        window.scrollTo({ top: 0, behavior: "smooth" })
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
