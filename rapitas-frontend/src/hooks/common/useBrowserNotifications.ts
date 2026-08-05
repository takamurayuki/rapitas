'use client';

/**
 * Browser Notification Hook
 *
 * Connects to the SSE notifications channel and displays native browser
 * notifications using the Notification API. Handles permission requests,
 * reconnection, and event parsing.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { createLogger } from '@/lib/logger';
import { sharedEventSource } from '@/lib/sse/shared-event-source';

const logger = createLogger('useBrowserNotifications');

/** Notification event payload from SSE. */
export interface SSENotificationPayload {
  notification: {
    id: number;
    type: string;
    title: string;
    message: string;
    link?: string | null;
    metadata?: Record<string, unknown>;
  };
  unreadCount: number;
}

/** Hook options. */
interface UseBrowserNotificationsOptions {
  /** Enable/disable the hook. Defaults to true. */
  enabled?: boolean;
  /** Callback when a notification is received. */
  onNotification?: (payload: SSENotificationPayload) => void;
}

/**
 * Subscribe to SSE notifications and show browser push notifications.
 *
 * Requests Notification API permission on mount. Connects to the
 * notifications SSE channel and displays native notifications for
 * each event received.
 *
 * @param options - Hook configuration. / フック設定
 * @returns Permission state and unread count. / 許可状態と未読数
 */
export function useBrowserNotifications(options: UseBrowserNotificationsOptions = {}) {
  const { enabled = true, onNotification } = options;
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [unreadCount, setUnreadCount] = useState(0);
  const onNotificationRef = useRef(onNotification);

  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);

  // Request notification permission
  const requestPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      setPermission('granted');
      return;
    }

    if (Notification.permission !== 'denied') {
      const result = await Notification.requestPermission();
      setPermission(result);
    } else {
      setPermission('denied');
    }
  }, []);

  // Show native browser notification
  const showNotification = useCallback((payload: SSENotificationPayload) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    // NOTE: Don't show notification if the window is focused — avoid duplicating in-app notifications.
    if (document.hasFocus()) return;

    const { notification } = payload;
    const icon = '/icon-192x192.png';

    const n = new Notification(notification.title, {
      body: notification.message,
      icon,
      tag: `rapitas-${notification.id}`,
      silent: false,
    });

    n.onclick = () => {
      window.focus();
      n.close();
    };

    // Auto-close after 5 seconds
    setTimeout(() => n.close(), 5000);
  }, []);

  // Subscribe to notification events on the SHARED SSE connection. A dedicated
  // per-mount EventSource here previously added to the browser's 6-per-origin
  // connection budget alongside every other SSE hook.
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    requestPermission();

    return sharedEventSource.subscribe('new_notification', (event) => {
      try {
        const payload = JSON.parse(event.data) as SSENotificationPayload;
        setUnreadCount(payload.unreadCount);
        showNotification(payload);
        onNotificationRef.current?.(payload);
      } catch (e) {
        logger.errorThrottled('Failed to parse notification event:', e);
      }
    });
  }, [enabled, requestPermission, showNotification]);

  return { permission, unreadCount, requestPermission };
}
