import type { Ad } from "../types/ad";

export type Category = 'work' | 'sell' | 'buy' | 'service' | 'rent';

export const ADS: Ad[] = [
    {
        id: "1",
        title: 'Робота на складі Amazon',
        description: 'Робота на сучасному складі Amazon. Гнучкий графік.',
        city: 'Warszawa',
        voivodeship: 'mazowieckie',
        category: 'work',
        price: '25 zł/год',
        isPremium: true,
        image: '/img/amazon.jpg',
        createdAt: Date.now() - 86400000,
        location: {
            lat: 52.2297,
            lng: 21.0122,
        },
        userId: "seed-user",
    },
    {
        id: "2",
        title: 'Продам велосипед',
        description: 'Гірський велосипед у хорошому стані.',
        city: 'Kraków',
        voivodeship: 'malopolskie',
        category: 'sell',
        price: '900 zł',
        isPremium: false,
        image: '/img/amazon.jpg',
        createdAt: Date.now() - 2 * 86400000,
        location: {
            lat: 50.0647,
            lng: 19.9450,
        },
        userId: "seed-user",
    },
    {
        id: "3",
        title: 'Послуги манікюру',
        description: 'Манікюр та педикюр, досвід 5 років.',
        city: 'Wrocław',
        voivodeship: 'dolnoslaskie',
        category: 'service',
        price: '—',
        isPremium: false,
        image: '/img/amazon.jpg',
        createdAt: Date.now(),
        location: {
            lat: 51.1079,
            lng: 17.0385,
        },
        userId: "seed-user",
    },
];
