'use client';

/**
 * NotificationToaster
 *
 * Global bridge from the SSE notification stream to something the user can
 * actually SEE the moment it arrives: an in-app toast while the window is
 * focused, and a native browser notification when it is not (the latter via
 * useBrowserNotifications, which was previously never mounted — the bell
 * badge was the only, easily-missed, signal). Renders nothing itself.
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useBrowserNotifications } from '@/hooks/common/useBrowserNotifications';
import { useToast } from '@/components/ui/toast/ToastContainer';

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
      // Unfocused windows already got the native notification from the hook;
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

  return null;
}
