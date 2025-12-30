import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../app/firebase"; // убедись, что app экспортируется

const functions = getFunctions(app);

export const verifyPayPalPayment = httpsCallable<
    {
        orderId: string;
        targetType: "ad" | "auction";
        targetId: string;
        promotionType: string;
    },
    {
        ok: boolean;
        promotionUntil: number;
    }
>(functions, "verifyPayPalPayment");
