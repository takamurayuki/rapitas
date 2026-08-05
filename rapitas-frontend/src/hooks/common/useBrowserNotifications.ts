'use client';

/**
 * Browser Notification Hook
 *
 * Connects to the SSE notifications channel and displays native OS
 * notifications: the Tauri notification plugin inside the desktop app
 * (real Windows toasts — WebView2 has no working Notification API), the
 * browser Notification API otherwise. Handles permission requests,
 * reconnection, and event parsing.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { createLogger } from '@/lib/logger';
import { sharedEventSource } from '@/lib/sse/shared-event-source';
import { isTauri } from '@/utils/tauri';

const logger = createLogger('useBrowserNotifications');

/** Reminder types alert even while the window is focused — that is their job. */
const REMINDER_TYPES = new Set(['memo_reminder', 'habit_reminder', 'schedule_reminder']);

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

  // Request notification permission (browser only — the Tauri plugin path
  // requests its own permission lazily on first send)
  const requestPermission = useCallback(async () => {
    if (typeof window === 'undefined' || isTauri() || !('Notification' in window)) return;

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

  // Show a native OS notification (Tauri plugin in the desktop app, browser
  // Notification API elsewhere).
  const showNotification = useCallback((payload: SSENotificationPayload) => {
    if (typeof window === 'undefined') return;
    const { notification } = payload;
    // Reminders alert even while focused (the user asked for OS-level
    // visibility); everything else stays quiet unless the window is in the
    // background, to avoid double-alerting on top of the in-app UI.
    if (!REMINDER_TYPES.has(notification.type) && document.hasFocus()) return;

    if (isTauri()) {
      // Real Windows toast via the Tauri plugin — WebView2's Notification API
      // is not functional, so the browser path below never fires in-app.
      void (async () => {
        try {
          const { isPermissionGranted, requestPermission, sendNotification } =
            await import('@tauri-apps/plugin-notification');
          let granted = await isPermissionGranted();
          if (!granted) granted = (await requestPermission()) === 'granted';
          if (granted) {
            sendNotification({ title: notification.title, body: notification.message });
          }
        } catch (e) {
          // Older desktop binaries lack the plugin — the in-app toast still shows.
          logger.errorThrottled('Tauri notification failed:', e);
        }
      })();
      return;
    }

    if (!('Notification' in window) || Notification.permission !== 'granted') return;
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
