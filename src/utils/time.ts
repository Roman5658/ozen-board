export function getTimeLeft(endAt: string): string {
    const diff = new Date(endAt).getTime() - Date.now()

    if (diff <= 0) return 'Завершено'

    const minutes = Math.floor(diff / 1000 / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) {
        return `${hours} год ${minutes % 60} хв`
    }

    return `${minutes} хв`
}
