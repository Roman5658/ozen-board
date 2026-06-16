export async function getUserPublicNicknames(
    userIds: string[],
    fallback = "User"
): Promise<Record<string, string>> {
    const ids = Array.from(new Set(userIds.map(id => id.trim()).filter(Boolean)))
    return Object.fromEntries(ids.map(id => [id, fallback]))
}

export async function getUserPublicNickname(userId: string, fallback = "User"): Promise<string> {
    const names = await getUserPublicNicknames([userId], fallback)
    return names[userId] ?? fallback
}
