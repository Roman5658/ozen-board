const LOCAL_EMULATOR_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export function shouldConnectFirestoreEmulator(
    isDevelopmentBuild: boolean,
    explicitOptIn: string | undefined,
    hostname: string,
): boolean {
    const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return isDevelopmentBuild && explicitOptIn === "true" && LOCAL_EMULATOR_HOSTNAMES.has(normalizedHostname);
}
