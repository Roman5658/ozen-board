import assert from "node:assert/strict";
import test from "node:test";
import { shouldConnectFirestoreEmulator } from "../src/app/firebaseRuntime";

test("Firestore emulator requires development, explicit opt-in, and a loopback host", () => {
    assert.equal(shouldConnectFirestoreEmulator(true, "true", "localhost"), true);
    assert.equal(shouldConnectFirestoreEmulator(true, "true", "127.0.0.1"), true);
    assert.equal(shouldConnectFirestoreEmulator(true, "true", "[::1]"), true);
    assert.equal(shouldConnectFirestoreEmulator(true, undefined, "localhost"), false);
    assert.equal(shouldConnectFirestoreEmulator(true, "false", "localhost"), false);
    assert.equal(shouldConnectFirestoreEmulator(true, "true", "ozen-board.test"), false);
    assert.equal(shouldConnectFirestoreEmulator(false, "true", "localhost"), false);
});
