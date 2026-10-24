import { onCall } from "firebase-functions/v2/https";
import { isExternalListingsEnabled } from "./partnerJsonFeedAdapter";
import { isTelegramListingsCatalogEnabled } from "./telegramListingsAdapter";

/** Public, non-sensitive switch used to keep the client catalog in sync with the importer. */
export const getExternalListingsConfig = onCall(() => ({
    enabled: isExternalListingsEnabled(),
    telegramEnabled: isTelegramListingsCatalogEnabled(),
}));
