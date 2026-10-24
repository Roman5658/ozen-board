import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../app/firebase";
import type { CatalogCategoryId, CatalogSubcategoryId } from "../data/catalogCategories";

export type CreateAdPayload = {
    title: string;
    description: string;
    category: "work" | "sell" | "buy" | "service" | "rent";
    catalogCategory?: CatalogCategoryId;
    catalogSubcategory?: CatalogSubcategoryId;
    voivodeship: string;
    city: string;
    price: string;
    priceType?: "paid" | "free" | "exchange";
    exchangeDetails?: string;
    images?: string[];
    sellerContact?: string;
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
