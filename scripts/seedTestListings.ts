import { applicationDefault, getApps, initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import type { DocumentReference, Firestore } from "firebase-admin/firestore"

const SEED_BATCH = "pagination-test-001"
const SEED_MARKERS = {
    seeded: true,
    seedBatch: SEED_BATCH,
    createdBySeedScript: true,
} as const

const DAY_MS = 24 * 60 * 60 * 1000
const ADS_COUNT = 100
const AUCTIONS_COUNT = 5
const USERS_COUNT = 8

type Mode = "dry-run" | "write" | "cleanup"
type SeedDocument = Record<string, unknown>
type SeedWrite = {
    collectionName: "users" | "ads" | "auctions"
    id: string
    data: SeedDocument
}

type SeedUser = {
    id: string
    uid: string
    email: string
    nickname: string
    status: "active"
    karma: number
    createdAt: number
    updatedAt: number
    phone: null
    telegram: null
} & typeof SEED_MARKERS

const locations = [
    { voivodeship: "mazowieckie", city: "Warszawa" },
    { voivodeship: "mazowieckie", city: "Radom" },
    { voivodeship: "malopolskie", city: "Kraków" },
    { voivodeship: "dolnoslaskie", city: "Wrocław" },
    { voivodeship: "pomorskie", city: "Gdynia" },
    { voivodeship: "pomorskie", city: "Sopot" },
    { voivodeship: "wielkopolskie", city: "Kalisz" },
    { voivodeship: "wielkopolskie", city: "Konin" },
    { voivodeship: "kujawskoPomorskie", city: "Bydgoszcz" },
    { voivodeship: "kujawskoPomorskie", city: "Toruń" },
    { voivodeship: "lubelskie", city: "Lublin" },
    { voivodeship: "slaskie", city: "Katowice" },
    { voivodeship: "slaskie", city: "Tychy" },
    { voivodeship: "opolskie", city: "Opole" },
    { voivodeship: "podkarpackie", city: "Mielec" },
] as const

const adCategories = ["sell", "buy", "service", "rent", "work"] as const
const auctionCategories = ["sell", "buy", "service", "rent"] as const

const users = Array.from({ length: USERS_COUNT }, (_, index): SeedUser => {
    const number = index + 1
    const email = `seed.user.${String(number).padStart(2, "0")}@example.test`

    return {
        id: email,
        uid: `seed-uid-${String(number).padStart(2, "0")}`,
        email,
        nickname: `Seed User ${number}`,
        status: "active",
        karma: 0,
        createdAt: Date.now() - (USERS_COUNT - index) * DAY_MS,
        updatedAt: Date.now(),
        phone: null,
        telegram: null,
        ...SEED_MARKERS,
    }
})

const adTemplates = [
    {
        title: "iPhone 14 Pro 128GB",
        description: "Telefon w bardzo dobrym stanie, bateria trzyma dobrze, komplet z etui.",
        category: "sell",
        price: "2450",
    },
    {
        title: "MacBook Air M1 do pracy",
        description: "Lekki laptop do nauki i biura, klawiatura sprawna, ekran bez uszkodzen.",
        category: "sell",
        price: "2850",
    },
    {
        title: "BMW E90 2.0 Diesel",
        description: "Auto jezdzi codziennie, aktualne oplaty, do obejrzenia po kontakcie.",
        category: "sell",
        price: "16800",
    },
    {
        title: "Шукаю велосипед для підлітка",
        description: "Потрібен справний велосипед, бажано з можливістю перевірити перед покупкою.",
        category: "buy",
        price: "600",
    },
    {
        title: "Naprawa laptopow i telefonow",
        description: "Diagnoza, wymiana dyskow, czyszczenie, instalacja systemu po uzgodnieniu.",
        category: "service",
        price: "80",
    },
    {
        title: "Оренда кімнати біля центру",
        description: "Кімната для однієї людини, спокійний район, поруч магазини і транспорт.",
        category: "rent",
        price: "1200",
    },
    {
        title: "Praca weekendowa w magazynie",
        description: "Pomoc przy pakowaniu zamowien, elastyczny grafik, stawka godzinowa.",
        category: "work",
        price: "28 zl/h",
    },
    {
        title: "Дитяче крісло для авто",
        description: "Крісло чисте, після однієї дитини, можна оглянути перед покупкою.",
        category: "sell",
        price: "190",
    },
    {
        title: "Stol drewniany do kuchni",
        description: "Solidny stol z drobnymi sladami uzywania, odbior osobisty.",
        category: "sell",
        price: "320",
    },
    {
        title: "Шукаю майстра для фарбування стін",
        description: "Потрібно пофарбувати дві кімнати, матеріали можу купити самостійно.",
        category: "service",
        price: "do uzgodnienia",
    },
] as const

const auctionTemplates = [
    {
        title: "Aukcja: konsola PlayStation 5",
        description: "Konsola sprawna, jeden pad, odbior osobisty lub wysylka po ustaleniu.",
        category: "sell",
        startPrice: 900,
    },
    {
        title: "Аукціон: комплект зимових шин",
        description: "Шини після двох сезонів, стан видно при огляді, продаж комплектом.",
        category: "sell",
        startPrice: 350,
    },
    {
        title: "Aukcja: aparat Canon z obiektywem",
        description: "Sprzet dziala poprawnie, w zestawie ladowarka i torba.",
        category: "sell",
        startPrice: 700,
    },
    {
        title: "Аукціон: велосипед міський",
        description: "Велосипед для міста, потрібне базове налаштування гальм.",
        category: "sell",
        startPrice: 250,
    },
    {
        title: "Aukcja: zestaw narzedzi domowych",
        description: "Zestaw do drobnych prac w domu, czesc narzedzi prawie nieuzywana.",
        category: "sell",
        startPrice: 120,
    },
] as const

function getMode(args: string[]): Mode {
    const wantsWrite = args.includes("--write")
    const wantsCleanup = args.includes("--cleanup")

    if (wantsWrite && wantsCleanup) {
        throw new Error("Use only one mode: --write or --cleanup.")
    }

    if (wantsWrite) return "write"
    if (wantsCleanup) return "cleanup"
    return "dry-run"
}

function hasConfirmation(args: string[]): boolean {
    const confirmIndex = args.indexOf("--confirm")
    return confirmIndex >= 0 && args[confirmIndex + 1] === SEED_BATCH
}

function getDb(): Firestore {
    if (!getApps().length) {
        const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT
        initializeApp({
            credential: applicationDefault(),
            ...(projectId ? { projectId } : {}),
        })
    }

    return getFirestore()
}

function buildAds(now: number): SeedWrite[] {
    return Array.from({ length: ADS_COUNT }, (_, index): SeedWrite => {
        const number = index + 1
        const template = adTemplates[index % adTemplates.length]
        const location = locations[index % locations.length]
        const user = users[index % users.length]
        const category = adCategories[index % adCategories.length]

        return {
            collectionName: "ads",
            id: `seedad${String(number).padStart(3, "0")}`,
            data: {
                title: `${template.title} #${number}`,
                description: template.description,
                category: category === template.category ? template.category : category,
                voivodeship: location.voivodeship,
                city: location.city,
                price: template.price,
                images: ["/apple-touch-icon.png"],
                userId: user.id,
                userName: user.nickname,
                userNickname: user.nickname,
                status: "active",
                createdAt: now - (ADS_COUNT - index) * 60 * 60 * 1000,
                updatedAt: now,
                ...SEED_MARKERS,
            },
        }
    })
}

function buildAuctions(now: number): SeedWrite[] {
    return Array.from({ length: AUCTIONS_COUNT }, (_, index): SeedWrite => {
        const number = index + 1
        const template = auctionTemplates[index]
        const location = locations[(index * 3) % locations.length]
        const user = users[(index + 2) % users.length]
        const startPrice = template.startPrice + index * 25

        return {
            collectionName: "auctions",
            id: `seedauction${String(number).padStart(3, "0")}`,
            data: {
                title: template.title,
                description: template.description,
                category: auctionCategories[index % auctionCategories.length],
                voivodeship: location.voivodeship,
                city: location.city,
                startPrice,
                buyNowPrice: null,
                currentBid: startPrice,
                bidsCount: 0,
                images: ["/apple-touch-icon.png"],
                ownerId: user.id,
                ownerName: user.nickname,
                ownerNickname: user.nickname,
                status: "active",
                createdAt: now - (index + 1) * 2 * 60 * 60 * 1000,
                updatedAt: now,
                endsAt: now + (7 + index) * DAY_MS,
                promotionType: "none",
                promotionUntil: null,
                promotionQueueAt: null,
                ...SEED_MARKERS,
            },
        }
    })
}

function buildUsers(): SeedWrite[] {
    return users.map((user) => ({
        collectionName: "users",
        id: user.id,
        data: user,
    }))
}

function buildSeedWrites(now: number): SeedWrite[] {
    return [
        ...buildUsers(),
        ...buildAds(now),
        ...buildAuctions(now),
    ]
}

function printPlan(writes: SeedWrite[]): void {
    const usersCount = writes.filter((write) => write.collectionName === "users").length
    const adsCount = writes.filter((write) => write.collectionName === "ads").length
    const auctionsCount = writes.filter((write) => write.collectionName === "auctions").length

    console.log("Xoven test listings seed")
    console.log(`Mode: dry-run, no Firestore writes will be made.`)
    console.log(`Seed batch: ${SEED_BATCH}`)
    console.log(`Users: ${usersCount}`)
    console.log(`Ads: ${adsCount}`)
    console.log(`Auctions: ${auctionsCount}`)
    console.log("")
    console.log("Sample ads:")
    writes
        .filter((write) => write.collectionName === "ads")
        .slice(0, 3)
        .forEach((write) => {
            console.log(`- ${write.id}: ${write.data.title} (${write.data.city})`)
        })
    console.log("")
    console.log("To write data, run:")
    console.log(`npm run seed:test-listings:write -- --confirm ${SEED_BATCH}`)
    console.log("")
    console.log("To clean up only this seed batch, run:")
    console.log(`npm run seed:test-listings:cleanup -- --confirm ${SEED_BATCH}`)
}

async function assertWritableSeedDoc(ref: DocumentReference): Promise<void> {
    const snap = await ref.get()
    if (!snap.exists) return

    const data = snap.data()
    const isOwnSeedDoc =
        data?.seeded === true &&
        data?.seedBatch === SEED_BATCH &&
        data?.createdBySeedScript === true

    if (!isOwnSeedDoc) {
        throw new Error(`Refusing to overwrite non-seed document: ${ref.path}`)
    }
}

async function writeSeedData(db: Firestore, writes: SeedWrite[]): Promise<void> {
    for (const write of writes) {
        await assertWritableSeedDoc(db.collection(write.collectionName).doc(write.id))
    }

    const batch = db.batch()
    for (const write of writes) {
        batch.set(db.collection(write.collectionName).doc(write.id), write.data)
    }

    await batch.commit()
    console.log(`Seed data written safely for batch ${SEED_BATCH}.`)
    console.log(`Created/updated documents: ${writes.length}`)
}

async function cleanupCollection(db: Firestore, collectionName: SeedWrite["collectionName"]): Promise<number> {
    const snap = await db.collection(collectionName).where("seedBatch", "==", SEED_BATCH).get()
    const docsToDelete = snap.docs.filter((docSnap) => {
        const data = docSnap.data()
        return data.seeded === true && data.createdBySeedScript === true && data.seedBatch === SEED_BATCH
    })

    if (!docsToDelete.length) return 0

    const batch = db.batch()
    docsToDelete.forEach((docSnap) => batch.delete(docSnap.ref))
    await batch.commit()

    return docsToDelete.length
}

async function cleanupSeedData(db: Firestore): Promise<void> {
    const usersDeleted = await cleanupCollection(db, "users")
    const adsDeleted = await cleanupCollection(db, "ads")
    const auctionsDeleted = await cleanupCollection(db, "auctions")

    console.log(`Cleanup finished for batch ${SEED_BATCH}.`)
    console.log(`Deleted users: ${usersDeleted}`)
    console.log(`Deleted ads: ${adsDeleted}`)
    console.log(`Deleted auctions: ${auctionsDeleted}`)
}

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    const mode = getMode(args)
    const now = Date.now()
    const writes = buildSeedWrites(now)

    if (mode === "dry-run") {
        printPlan(writes)
        return
    }

    if (!hasConfirmation(args)) {
        console.error(`Missing confirmation. Add: --confirm ${SEED_BATCH}`)
        process.exitCode = 1
        return
    }

    const db = getDb()

    if (mode === "write") {
        await writeSeedData(db, writes)
        return
    }

    await cleanupSeedData(db)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
