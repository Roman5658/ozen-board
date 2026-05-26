export type ReportStatus = 'new' | 'pending' | 'reviewed' | 'rejected' | 'resolved'
export type ReportTargetType = 'ad' | 'auction' | 'chat_message'
export type ReportModerationStatus = 'pending' | 'reviewed' | 'warned' | 'user_blocked' | 'rejected' | 'resolved'
export type ReportModerationAction = 'reviewed' | 'warning' | 'block_user' | 'rejected'

export type Report = {
    id: string
    targetType: ReportTargetType
    targetId: string
    reporterId: string
    reason: string
    description: string
    reasonType?: string | null
    reasonText?: string | null
    createdAt: number
    status: ReportStatus
    moderationStatus?: ReportModerationStatus | null
    moderationAction?: ReportModerationAction | null
    moderationNote?: string | null
    reporterMessage?: string | null
    reportedUserMessage?: string | null
    actionReason?: string | null
    processedAt?: number | null
    processedBy?: string | null
    reportedUserId?: string | null
    reviewedAt?: number | null
    reviewedBy?: string | null
    resolutionNote?: string | null
    notificationNeeded?: boolean | null
    ownerNotified?: boolean | null
    reporterNotified?: boolean | null
    type?: 'chat_message'
    chatId?: string
    messageId?: string
    senderId?: string
    senderName?: string | null
    reportedBy?: string
    reportedByName?: string | null
    messageText?: string
}
