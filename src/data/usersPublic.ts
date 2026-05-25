import { collection, documentId, getDocs, query, where } from "firebase/firestore"
import { db } from "../app/firebase"

function chunk<T>(items: T[], size: number): T[][] {
    const result: T[][] = []
    for (let i = 0; i < items.length; i += size) {
        result.push(items.slice(i, i + size))
    }
    return result
}

function readNickname(data: { nickname?: unknown; email?: unknown }, fallback: string): string {
    if (typeof data.nickname === "string" && data.nickname.trim()) {
        return data.nickname.trim()
    }

    if (typeof data.email === "string" && data.email.trim()) {
        return data.email.split("@")[0]
    }

    return fallback
}

export async function getUserPublicNicknames(
    userIds: string[],
    fallback = "Користувач"
): Promise<Record<string, string>> {
    const ids = Array.from(new Set(userIds.map(id => id.trim()).filter(Boolean)))
    if (ids.length === 0) return {}

    const result: Record<string, string> = {}
    const usersRef = collection(db, "users")

    await Promise.all(
        chunk(ids, 10).map(async (idsChunk) => {
            const snap = await getDocs(query(usersRef, where(documentId(), "in", idsChunk)))
            snap.docs.forEach((docSnap) => {
                result[docSnap.id] = readNickname(docSnap.data(), fallback)
            })
        })
    )

    const missingIds = ids.filter(id => !result[id])
    await Promise.all(
        chunk(missingIds, 10).map(async (idsChunk) => {
            const snap = await getDocs(query(usersRef, where("uid", "in", idsChunk)))
            snap.docs.forEach((docSnap) => {
                const data = docSnap.data()
                const uid = typeof data.uid === "string" ? data.uid : ""
                if (uid) result[uid] = readNickname(data, fallback)
            })
        })
    )

    ids.forEach(id => {
        result[id] ??= fallback
    })

    return result
}

export async function getUserPublicNickname(userId: string, fallback = "Користувач"): Promise<string> {
    const names = await getUserPublicNicknames([userId], fallback)
    return names[userId] ?? fallback
}
