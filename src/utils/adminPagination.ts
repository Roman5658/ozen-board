export type PaginationLabels = {
    previous: string
    next: string
    page: (page: number, totalPages: number) => string
    count: (totalItems: number) => string
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
