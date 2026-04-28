'use client';
import { useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { requestNotificationPermission, showDesktopNotification } from '@/utils/notification';
import type { ScheduleEvent } from '@/types';

const CHECK_INTERVAL_MS = 30_000; // Check every 30 seconds

/**
 * Hook that periodically checks for schedule reminder notifications
 * and displays desktop notifications
 */
export function useScheduleReminders() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const permissionGranted = useRef(false);

  const checkReminders = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${API_BASE_URL}/schedules/reminders/pending`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) return;

      const pendingEvents: ScheduleEvent[] = await res.json();

      for (const event of pendingEvents) {
        const startDate = new Date(event.startAt);
        const timeStr = event.isAllDay
          ? '終日'
          : startDate.toLocaleTimeString('ja-JP', {
              hour: '2-digit',
              minute: '2-digit',
            });

        showDesktopNotification(`Rapitas - ${event.title}`, {
          body: `${timeStr} に予定があります`,
          tag: `schedule-reminder-${event.id}`,
          onClick: () => {
            window.location.href = '/calendar';
          },
        });

        // Mark reminder as sent
        await fetch(`${API_BASE_URL}/schedules/reminders/${event.id}/sent`, {
          method: 'POST',
          signal: AbortSignal.timeout(5000),
        }).catch(() => {
          // Ignore failures since notification was already shown
        });
      }
    } catch {
      // Silently ignore network errors/timeouts (background check)
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  useEffect(() => {
    // Request notification permission on first load
    requestNotificationPermission().then((granted) => {
      permissionGranted.current = granted;
    });

    // Start periodic checks
    checkReminders();
    intervalRef.current = setInterval(checkReminders, CHECK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [checkReminders]);
}
