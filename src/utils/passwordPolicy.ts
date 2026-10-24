export const FIREBASE_PASSWORD_MIN_LENGTH = 6;
export const FIREBASE_PASSWORD_MAX_LENGTH = 4096;

export type PasswordValidationIssue = "required" | "too-short" | "too-long" | "control-character";

export function getPasswordValidationIssue(
    password: string,
    purpose: "login" | "register",
): PasswordValidationIssue | null {
    const length = Array.from(password).length;
    if (length === 0) return "required";
    if (purpose === "register" && length < FIREBASE_PASSWORD_MIN_LENGTH) return "too-short";
    if (length > FIREBASE_PASSWORD_MAX_LENGTH) return "too-long";
    const containsControlCharacter = Array.from(password).some(character => {
        const code = character.codePointAt(0) ?? 0;
        return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    });
    if (containsControlCharacter) return "control-character";
    return null;
}
