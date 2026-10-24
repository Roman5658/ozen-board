import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../app/firebase";
import {
    isExternalListingsConfigEnabled,
    isTelegramListingsConfigEnabled,
} from "../utils/externalListingsVisibility";

export type ExternalListingsConfig = {
    enabled: boolean;
    telegramEnabled: boolean;
};

const getExternalListingsConfig = httpsCallable<void, ExternalListingsConfig>(
    getFunctions(app),
    "getExternalListingsConfig",
);

let configPromise: Promise<ExternalListingsConfig> | undefined;

/** Fail closed when the configuration function is unavailable. */
export function loadExternalListingsConfig(): Promise<ExternalListingsConfig> {
    if (!configPromise) {
        configPromise = getExternalListingsConfig()
            .then((result) => ({
                enabled: isExternalListingsConfigEnabled(result.data),
                telegramEnabled: isTelegramListingsConfigEnabled(result.data),
            }))
            .catch(() => ({ enabled: false, telegramEnabled: false }));
    }
    return configPromise;
}

export function loadExternalListingsEnabled(): Promise<boolean> {
    return loadExternalListingsConfig().then((config) => config.enabled);
}
