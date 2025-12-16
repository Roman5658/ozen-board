import type { Ad } from "../types/ad";

export type Category = 'work' | 'sell' | 'buy' | 'service' | 'rent'


export const ADS: Ad[] = [
    {
        id: 1,
        title: 'Робота на складі Amazon',
        description: 'Робота на сучасному складі Amazon. Гнучкий графік.',
        city: 'Warszawa',
        voivodeship: 'mazowieckie',
        category: 'work',
        price: '25 zł/год',
        isPremium: true,
        image: '/img/amazon.jpg',
        createdAt: Date.now() - 86400000,
    },
    {
        id: 2,
        title: 'Продам велосипед',
        description: 'Гірський велосипед у хорошому стані.',
        city: 'Kraków',
        voivodeship: 'malopolskie',
        category: 'sell',
        price: '900 zł',
        isPremium: false,
        image: '/img/amazon.jpg',
        createdAt: Date.now() - 2 * 86400000,
    },
    {
        id: 3,
        title: 'Послуги манікюру',
        description: 'Манікюр та педикюр, досвід 5 років.',
        city: 'Wrocław',
        voivodeship: 'dolnoslaskie',
        category: 'service',
        isPremium: false,
        image: '/img/amazon.jpg',
        createdAt: Date.now(),
    },
]
