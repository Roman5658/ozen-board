export type ReportStatus = 'new' | 'pending' | 'reviewed' | 'rejected' | 'resolved'
export type ReportTargetType = 'ad' | 'auction' | 'chat_message'

export type Report = {
    id: string
    targetType: ReportTargetType
    targetId: string
    reporterId: string
    reason: string
    description: string
    createdAt: number
    status: ReportStatus
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
