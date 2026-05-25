export type ReportStatus = 'new' | 'reviewed' | 'rejected' | 'resolved'
export type ReportTargetType = 'ad' | 'auction'

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
}
