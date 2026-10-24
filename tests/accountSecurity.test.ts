import assert from "node:assert/strict";
import test from "node:test";
import { getPasswordValidationIssue } from "../src/utils/passwordPolicy.ts";
import { isReservedAdminNickname, isValidNickname, normalizeNicknameSkeleton } from "../src/utils/nicknameSecurity.ts";

test("passwords may contain punctuation and are never trimmed or normalized", () => {
    assert.equal(getPasswordValidationIssue("p@ss! word?", "register"), null);
    assert.equal(getPasswordValidationIssue(" 123456 ", "register"), null);
});

test("registration applies Firebase length bounds while login keeps existing passwords usable", () => {
    assert.equal(getPasswordValidationIssue("12345", "register"), "too-short");
    assert.equal(getPasswordValidationIssue("12345", "login"), null);
    assert.equal(getPasswordValidationIssue("x".repeat(4097), "login"), "too-long");
});

test("passwords containing control characters are rejected", () => {
    assert.equal(getPasswordValidationIssue("abc\ndef", "register"), "control-character");
    assert.equal(getPasswordValidationIssue(`abc${String.fromCharCode(0)}def`, "login"), "control-character");
});

test("reserved admin nickname is blocked across case, separators, width variants, and common homoglyphs", () => {
    for (const nickname of [
        "XovenAdmin",
        "Xoven Admin",
        " Xoven Admin ",
        "xoven_admin",
        "Xoven.Admin",
        "XOVEN-ADMIN",
        "ＸｏｖｅｎＡｄｍｉｎ",
        "XоvenAdmin", // Cyrillic о
        "XovenAdmіn", // Cyrillic і
    ]) {
        assert.equal(isReservedAdminNickname(nickname), true, nickname);
        assert.equal(isValidNickname(nickname), false, nickname);
    }
    assert.equal(isReservedAdminNickname("XovenAdmin2"), false);
    assert.equal(normalizeNicknameSkeleton("Xoven_Admin"), "xovenadmin");
});
