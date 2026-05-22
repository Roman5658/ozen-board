export type ReportStatus = 'new' | 'reviewed' | 'rejected' | 'resolved'
export type Report = {
    id: string
    adId: string
    adTitle: string
    targetUserId: string
    targetUserName?: string
    reporterUserId?: string
    reporterUserName?: string
    message: string
    reason?: string
    createdAt: number
    status: ReportStatus
}
