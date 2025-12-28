import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
    apiKey: "AIzaSyD-BbY47lrS4jiwsmsqX8vlN4rLSHGeECg",
    authDomain: "ozen-board.firebaseapp.com",
    projectId: "ozen-board",
    storageBucket: "ozen-board.firebasestorage.app",
    messagingSenderId: "377518833288",
    appId: "1:377518833288:web:489ad53aad7d318574a93d",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app)