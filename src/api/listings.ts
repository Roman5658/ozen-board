import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../app/firebase";

export type CreateAdPayload = {
    title: string;
    description: string;
    category: "work" | "sell" | "buy" | "service" | "rent";
    voivodeship: string;
    city: string;
    price: string;
    images?: string[];
    sellerContact?: string;
    userName?: string | null;
    userNickname?: string | null;
    location?: {
        lat: number;
        lng: number;
    };
};

const functions = getFunctions(app);

export const createAd = httpsCallable<CreateAdPayload, { id: string }>(
    functions,
    "createAd"
);
