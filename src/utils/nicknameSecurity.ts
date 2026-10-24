const CONFUSABLES: Record<string, string> = {
    а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", і: "i", ј: "j", ѕ: "s",
    у: "y", к: "k", м: "m", т: "t", в: "b", н: "h", п: "n", ӏ: "l",
    α: "a", β: "b", ε: "e", ι: "i", κ: "k", μ: "m", ν: "v", ο: "o", ρ: "p",
    τ: "t", υ: "y", χ: "x",
};

export function normalizeNicknameSkeleton(value: string): string {
    return Array.from(value.normalize("NFKC").toLowerCase())
        .map(character => CONFUSABLES[character] ?? character)
        .join("")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f\u200b-\u200f\u202a-\u202e\u2060\ufeff\s._-]+/g, "");
}

export function isReservedAdminNickname(value: string): boolean {
    return normalizeNicknameSkeleton(value) === "xovenadmin";
}

export function isValidNickname(value: string): boolean {
    const nickname = value.trim();
    return nickname.length > 0 &&
        nickname.length <= 80 &&
        /^[A-Za-z0-9._-]+$/.test(nickname) &&
        !isReservedAdminNickname(nickname);
}
