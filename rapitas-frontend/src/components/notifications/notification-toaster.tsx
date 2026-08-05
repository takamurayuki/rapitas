'use client';

/**
 * NotificationToaster
 *
 * Global bridge from the SSE notification stream to something the user can
 * actually SEE the moment it arrives. In the desktop app the hook opens the
 * app's own always-on-top toast window, so this component only relays that
 * window's click-navigation back into the router; in a plain browser it shows
 * an in-app toast while focused (the hook's native browser notification
 * covers the unfocused case). Renders nothing itself.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useBrowserNotifications } from '@/hooks/common/useBrowserNotifications';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { isTauri } from '@/utils/tauri';

/** Types worth an interruptive toast — quiet ones stay bell-only. */
const TOASTED_TYPES = new Set(['memo_reminder', 'habit_reminder', 'schedule_reminder']);

/**
 * Mount the notification-to-toast bridge (no visual output of its own).
 */
export function NotificationToaster() {
  const { showToast } = useToast();
  const router = useRouter();
  const t = useTranslations('notification');

  useBrowserNotifications({
    onNotification: ({ notification }) => {
      // Desktop: the global toast window already covers focused AND unfocused
      // — an in-app toast on top of it would be a duplicate.
      if (isTauri()) return;
      // Unfocused browsers already got the native notification from the hook;
      // the toast covers the focused case it deliberately skips.
      if (!document.hasFocus()) return;
      if (!TOASTED_TYPES.has(notification.type)) return;
      const link = notification.link;
      showToast(
        `${notification.title}: ${notification.message}`,
        'info',
        link ? { action: { label: t('open'), onClick: () => router.push(link) } } : undefined,
      );
    },
  });

  // Clicking the global toast window lands here: the Rust side focuses the
  // main window and emits the link for the SPA router to open.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<string>('rapitas:toast-navigate', (e) => {
        if (e.payload) router.push(e.payload);
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => unlisten?.();
  }, [router]);

  return null;
}
