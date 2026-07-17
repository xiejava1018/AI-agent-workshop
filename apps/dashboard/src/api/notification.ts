/**
 * 站内通知 API
 * AI-agent-workshop 后端暂无通知功能，返回空数据以避免 401/404。
 */

export interface NotificationItem {
  id: string
  user_id: number
  type: 'alert' | 'ai_done' | 'system' | 'test'
  title: string
  content: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

export interface NotificationListResp {
  total: number
  items: NotificationItem[]
  page: number
  page_size: number
}

/** 通知列表（可筛选 is_read） */
export const fetchNotifications = (_params?: { page?: number; page_size?: number; is_read?: boolean }) => {
  return Promise.resolve({
    code: 200,
    msg: 'ok',
    data: { total: 0, items: [], page: 1, page_size: 20 }
  } as Http.BaseResponse<NotificationListResp>)
}

/** 未读数 */
export const fetchUnreadCount = () => {
  return Promise.resolve({
    code: 200,
    msg: 'ok',
    data: { count: 0 }
  } as Http.BaseResponse<{ count: number }>)
}

/** 标记单条已读 */
export const markNotificationRead = (_id: string) => {
  return Promise.resolve({
    code: 200,
    msg: 'ok',
    data: {} as NotificationItem
  } as Http.BaseResponse<NotificationItem>)
}

/** 全标已读 */
export const markAllNotificationsRead = () => {
  return Promise.resolve({
    code: 200,
    msg: 'ok',
    data: { updated: 0 }
  } as Http.BaseResponse<{ updated: number }>)
}
