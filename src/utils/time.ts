export function getTimeLeft(endsAt: number): string {
    const diff = endsAt - Date.now()

    if (diff <= 0) return 'Завершено'

    const totalMinutes = Math.floor(diff / 1000 / 60)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60

    if (hours > 0) {
        return `${hours} год ${minutes} хв`
    }

    return `${minutes} хв`
}
