const CONFUSABLES: Record<string, string> = {
    а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", і: "i", ј: "j", ѕ: "s",
    у: "y", к: "k", м: "m", т: "t", в: "b", н: "h", п: "n", ӏ: "l",
    α: "a", β: "b", ε: "e", ι: "i", κ: "k", μ: "m", ν: "v", ο: "o", ρ: "p",
    τ: "t", υ: "y", χ: "x",
};

export function isReservedAdminNickname(value: string): boolean {
    const skeleton = Array.from(value.normalize("NFKC").toLowerCase())
        .map((character) => CONFUSABLES[character] ?? character)
        .join("")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f\u200b-\u200f\u202a-\u202e\u2060\ufeff\s._-]+/g, "");

    return skeleton === "xovenadmin";
}

/** Never use client supplied display names for server-created listings. */
export function getTrustedAdSellerName(trustedNickname: string | null, email: string | null): string {
    const emailName = email?.split("@")[0]?.trim() ?? "";
    const profileName = trustedNickname?.trim() ?? "";
    if (profileName && !isReservedAdminNickname(profileName)) return profileName;
    return emailName && !isReservedAdminNickname(emailName) ? emailName : "User";
}
