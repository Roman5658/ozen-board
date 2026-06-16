import { applicationDefault, getApps, initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import type { DocumentData, Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore"

type BackfillCandidate = {
    adId: string
    title: string
    userId: string
    nickname: string
}

type BackfillStats = {
    adsScanned: number
    usersScanned: number
    skippedNonEmailUserId: number
    skippedExistingPublicName: number
    skippedMissingUser: number
    skippedMissingNickname: number
}

const SAMPLE_LIMIT = 10

function showHelp() {
    console.log(`
Backfill public ad seller names from private users with Firebase Admin SDK.

Dry-run:
  npm run backfill:ad-seller-names

Apply:
  npm run backfill:ad-seller-names -- --apply

Requires admin/server credentials, for example:
  $env:GOOGLE_APPLICATION_CREDENTIALS="C:\\path\\service-account.json"
`)
}

function hasFlag(flag: string): boolean {
    return process.argv.slice(2).includes(flag)
}

function getDb(): Firestore {
    if (!getApps().length) {
        const projectId =
            process.env.FIREBASE_PROJECT_ID ||
            process.env.GCLOUD_PROJECT ||
            process.env.GOOGLE_CLOUD_PROJECT ||
            "ozen-board"

        initializeApp({
            credential: applicationDefault(),
            projectId,
        })
    }

    return getFirestore()
}

function readString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeEmail(value: string): string {
    return value.trim().toLowerCase()
}

function isEmailLike(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function getUserNickname(docSnap: QueryDocumentSnapshot<DocumentData>): string | null {
    const data = docSnap.data()
    return readString(data.nickname)
}

async function loadUserNicknamesByEmail(db: Firestore): Promise<{
    usersByEmail: Map<string, string>
    usersScanned: number
    skippedMissingNickname: number
}> {
    const usersSnap = await db.collection("users").get()
    const usersByEmail = new Map<string, string>()
    let skippedMissingNickname = 0

    usersSnap.docs.forEach((docSnap) => {
        const nickname = getUserNickname(docSnap)
        if (!nickname) {
            skippedMissingNickname += 1
            return
        }

        usersByEmail.set(normalizeEmail(docSnap.id), nickname)

        const email = readString(docSnap.data().email)
        if (email) usersByEmail.set(normalizeEmail(email), nickname)
    })

    return {
        usersByEmail,
        usersScanned: usersSnap.size,
        skippedMissingNickname,
    }
}

async function findBackfillCandidates(db: Firestore): Promise<{
    candidates: BackfillCandidate[]
    stats: BackfillStats
}> {
    const { usersByEmail, usersScanned, skippedMissingNickname } = await loadUserNicknamesByEmail(db)
    const adsSnap = await db.collection("ads").get()
    const candidates: BackfillCandidate[] = []
    const stats: BackfillStats = {
        adsScanned: adsSnap.size,
        usersScanned,
        skippedNonEmailUserId: 0,
        skippedExistingPublicName: 0,
        skippedMissingUser: 0,
        skippedMissingNickname,
    }

    adsSnap.docs.forEach((docSnap) => {
        const data = docSnap.data()
        const userId = readString(data.userId)
        if (!userId || !isEmailLike(userId)) {
            stats.skippedNonEmailUserId += 1
            return
        }

        const currentUserName = readString(data.userName)
        const currentUserNickname = readString(data.userNickname)
        if (currentUserName || currentUserNickname) {
            stats.skippedExistingPublicName += 1
            return
        }

        const nickname = usersByEmail.get(normalizeEmail(userId))
        if (!nickname) {
            stats.skippedMissingUser += 1
            return
        }

        candidates.push({
            adId: docSnap.id,
            title: readString(data.title) ?? "(no title)",
            userId,
            nickname,
        })
    })

    return { candidates, stats }
}

async function applyBackfill(db: Firestore, candidates: BackfillCandidate[]) {
    const batchSize = 450

    for (let i = 0; i < candidates.length; i += batchSize) {
        const batch = db.batch()
        const chunk = candidates.slice(i, i + batchSize)

        chunk.forEach((candidate) => {
            batch.update(db.collection("ads").doc(candidate.adId), {
                userName: candidate.nickname,
                userNickname: candidate.nickname,
            })
        })

        await batch.commit()
        console.log(`Applied ${Math.min(i + batchSize, candidates.length)} / ${candidates.length}`)
    }
}

function printReport(candidates: BackfillCandidate[], stats: BackfillStats, apply: boolean) {
    console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`)
    console.log(`Users scanned: ${stats.usersScanned}`)
    console.log(`Ads scanned: ${stats.adsScanned}`)
    console.log(`Ads to update: ${candidates.length}`)
    console.log(`Skipped non-email userId: ${stats.skippedNonEmailUserId}`)
    console.log(`Skipped existing userName/userNickname: ${stats.skippedExistingPublicName}`)
    console.log(`Skipped missing users/{email}: ${stats.skippedMissingUser}`)
    console.log(`Skipped users without nickname: ${stats.skippedMissingNickname}`)

    console.log("\nSample changes:")
    candidates.slice(0, SAMPLE_LIMIT).forEach((candidate) => {
        console.log(
            `- ads/${candidate.adId}: "${candidate.title}" | ${candidate.userId} -> "${candidate.nickname}"`
        )
    })

    if (!apply) {
        console.log("\nDry-run only. Re-run with --apply to write userName/userNickname.")
    }
}

async function main() {
    if (hasFlag("--help") || hasFlag("-h")) {
        showHelp()
        return
    }

    const apply = hasFlag("--apply")
    const db = getDb()
    const { candidates, stats } = await findBackfillCandidates(db)
    printReport(candidates, stats, apply)

    if (!apply) return

    await applyBackfill(db, candidates)
    console.log("Backfill complete.")
}

main().catch((error) => {
    console.error("[backfill ad seller names] failed", error)
    process.exitCode = 1
})
