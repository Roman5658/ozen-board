import { initializeApp } from "firebase/app"

import { connectFirestoreEmulator, getFirestore } from "firebase/firestore"
import { getStorage } from "firebase/storage"
import { getAuth } from "firebase/auth"
import { shouldConnectFirestoreEmulator } from "./firebaseRuntime"

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
const emulatorOptIn = import.meta.env.VITE_USE_FIRESTORE_EMULATOR
if (emulatorOptIn === "true" && !shouldConnectFirestoreEmulator(import.meta.env.DEV, emulatorOptIn, window.location.hostname)) {
    throw new Error("Firestore Emulator requires a local dev server and explicit opt-in")
}
if (shouldConnectFirestoreEmulator(import.meta.env.DEV, emulatorOptIn, window.location.hostname)) {
    const port = Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT ?? "8088")
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Invalid Firestore emulator port")
    }
    // Local browser verification only; production builds reject the opt-in above.
    connectFirestoreEmulator(db, "127.0.0.1", port)
}
export const storage = getStorage(app)
