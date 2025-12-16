export type Lang = 'uk' | 'pl'

export const DEFAULT_LANG: Lang = 'uk'

export const translations = {
    uk: {
        title: 'Ozen Board',
        subtitle: 'Локальна дошка оголошень',
        warning: 'Будьте обережні з передоплатою та підозрілими пропозиціями',

        langLabel: 'Мова',

        homeTitle: 'Оголошення',
        nearbyTitle: 'Оголошення поруч',
        addTitle: 'Додати оголошення',
        auctionTitle: 'Аукціон',
        accountTitle: 'Мій акаунт',
        categories: {
            all: 'Усі',
            work: 'Робота',
            buySell: 'Купівля / Продаж',
            services: 'Послуги',

        },
        voivodeships: {
            all: 'Вся Польща',
            dolnoslaskie: 'Нижньосілезьке',
            kujawskoPomorskie: 'Куявсько-Поморське',
            lubelskie: 'Люблінське',
            lubuskie: 'Любуське',
            lodzkie: 'Лодзьке',
            malopolskie: 'Малопольське',
            mazowieckie: 'Мазовецьке',
            opolskie: 'Опольське',
            podkarpackie: 'Підкарпатське',
            podlaskie: 'Підляське',
            pomorskie: 'Поморське',
            slaskie: 'Сілезьке',
            swietokrzyskie: 'Свентокшиське',
            warminskoMazurskie: 'Вармінсько-Мазурське',
            wielkopolskie: 'Великопольське',
            zachodniopomorskie: 'Західнопоморське',
        },


    },
    pl: {
        title: 'Ozen Board',
        subtitle: 'Lokalna tablica ogłoszeń',
        warning: 'Uważaj na przedpłaty i podejrzane oferty',

        langLabel: 'Język',

        homeTitle: 'Ogłoszenia',
        nearbyTitle: 'Ogłoszenia w pobliżu',
        addTitle: 'Dodaj ogłoszenie',
        auctionTitle: 'Aukcja',
        accountTitle: 'Moje konto',
        categories: {
            all: 'Wszystko',
            work: 'Praca',
            buySell: 'Kupno / Sprzedaż',
            services: 'Usługi',
        },
        voivodeships: {
            all: 'Cała Polska',
            dolnoslaskie: 'Dolnośląskie',
            kujawskoPomorskie: 'Kujawsko-Pomorskie',
            lubelskie: 'Lubelskie',
            lubuskie: 'Lubuskie',
            lodzkie: 'Łódzkie',
            malopolskie: 'Małopolskie',
            mazowieckie: 'Mazowieckie',
            opolskie: 'Opolskie',
            podkarpackie: 'Podkarpackie',
            podlaskie: 'Podlaskie',
            pomorskie: 'Pomorskie',
            slaskie: 'Śląskie',
            swietokrzyskie: 'Świętokrzyskie',
            warminskoMazurskie: 'Warmińsko-Mazurskie',
            wielkopolskie: 'Wielkopolskie',
            zachodniopomorskie: 'Zachodniopomorskie',
        },


    },
} as const
