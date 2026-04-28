'use client';

import { useState, useCallback, useEffect } from 'react';
import type { Notification } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useNotifications');

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const fetchNotifications = useCallback(async (unreadOnly?: boolean, limit?: number) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (unreadOnly) params.append('unreadOnly', 'true');
      if (limit) params.append('limit', limit.toString());

      const res = await fetch(`${API_BASE_URL}/notifications?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
        return data;
      }
    } catch (err) {
      logger.error('Failed to fetch notifications:', err);
    } finally {
      setIsLoading(false);
    }
    return [];
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/notifications/unread-count`);
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.count);
        return data.count;
      }
    } catch (err) {
      logger.error('Failed to fetch unread count:', err);
    }
    return 0;
  }, []);

  const markAsRead = useCallback(async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/notifications/${id}/read`, {
        method: 'PATCH',
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n,
          ),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
        return true;
      }
    } catch (err) {
      logger.error('Failed to mark as read:', err);
    }
    return false;
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/notifications/mark-all-read`, {
        method: 'POST',
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => ({
            ...n,
            isRead: true,
            readAt: new Date().toISOString(),
          })),
        );
        setUnreadCount(0);
        return true;
      }
    } catch (err) {
      logger.error('Failed to mark all as read:', err);
    }
    return false;
  }, []);

  const deleteNotification = useCallback(async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/notifications/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setNotifications((prev) => {
          const deleted = prev.find((n) => n.id === id);
          if (deleted && !deleted.isRead) {
            setUnreadCount((c) => Math.max(0, c - 1));
          }
          return prev.filter((n) => n.id !== id);
        });
        return true;
      } else {
        const errorData = await res.json().catch(() => ({}));
        logger.error('Failed to delete notification:', res.status, errorData);
      }
    } catch (err) {
      logger.error('Failed to delete notification:', err);
    }
    return false;
  }, []);

  const deleteAllNotifications = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/notifications`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setNotifications([]);
        setUnreadCount(0);
        return true;
      } else {
        const errorData = await res.json().catch(() => ({}));
        logger.error('Failed to delete all notifications:', res.status, errorData);
      }
    } catch (err) {
      logger.error('Failed to delete all notifications:', err);
    }
    return false;
  }, []);

  // Fetch unread count on initial mount
  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  return {
    notifications,
    unreadCount,
    isLoading,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteAllNotifications,
  };
}
