import { apiRequest } from './api';
import type { InboxNotification } from '../types/Notifications.types';
export const readNotifications = (signal?: AbortSignal) => apiRequest<{ identityId: string; notifications: InboxNotification[] }>('/api/me/notifications', { signal });
export const readUnreadCount = (signal?: AbortSignal) => apiRequest<{ unread: number }>('/api/me/notifications/unread', { signal });
export const markNotificationsRead = (ids: string[]) => apiRequest<{ unread: number }>('/api/me/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
