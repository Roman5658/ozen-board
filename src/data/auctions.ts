export type Auction = {
    id: number
    title: string
    city: string
    currentBid: number
    endAt: string // ISO дата
}

export const AUCTIONS: Auction[] = [
    {
        id: 1,
        title: 'iPhone 13 Pro',
        city: 'Warszawa',
        currentBid: 2200,
        endAt: '2025-12-31T20:00:00',
    },
    {
        id: 2,
        title: 'Електросамокат Xiaomi',
        city: 'Kraków',
        currentBid: 800,
        endAt: '2025-12-20T18:30:00',
    },
    {
        id: 3,
        title: 'PlayStation 5',
        city: 'Wrocław',
        currentBid: 1800,
        endAt: '2025-12-18T19:00:00',
    },
    {
        id: 4,
        title: 'Rower górski',
        city: 'Poznań',
        currentBid: 950,
        endAt: '2025-12-22T21:00:00',
    },

]
