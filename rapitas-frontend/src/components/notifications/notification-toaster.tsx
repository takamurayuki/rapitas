'use client';

/**
 * NotificationToaster
 *
 * Global bridge from the SSE notification stream to something the user can
 * actually SEE the moment it arrives. In the desktop app the hook opens the
 * app's own always-on-top toast window; in a plain browser it shows an in-app
 * toast while focused. Also replays the newest reminder that fired while the
 * SSE link was down (backend restarts leave a blind window in which
 * notifications land only in the bell) and relays the toast window's
 * click-navigation back into the router. Renders nothing itself.
 */
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { extractMemoId, useBrowserNotifications } from '@/hooks/common/useBrowserNotifications';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { sharedEventSource } from '@/lib/sse/shared-event-source';
import { API_BASE_URL } from '@/utils/api';
import { isTauri } from '@/utils/tauri';

/** Types worth an interruptive toast — quiet ones stay bell-only. */
const TOASTED_TYPES = new Set(['memo_reminder', 'habit_reminder', 'schedule_reminder']);

/** How far back a missed reminder may be replayed after (re)connecting. */
const REPLAY_WINDOW_MS = 10 * 60_000;

/**
 * Persisted high-water mark of the newest reminder already surfaced.
 * MUST survive page loads: full-page navigations remount this component, and
 * an in-memory-only mark made every reload replay the latest unread reminder
 * again (observed: clicking a hard link on the task detail page popped the
 * memo toast each time).
 */
const LAST_SEEN_KEY = 'rapitas-reminder-last-seen';

const readLastSeen = (): number => {
  try {
    const raw = Number(localStorage.getItem(LAST_SEEN_KEY));
    if (Number.isFinite(raw) && raw > 0) return raw;
  } catch {
    /* storage unavailable → fall through */
  }
  // No stored mark (first run): start at "now" — never replay history the
  // user has not provably missed. The bell keeps the full backlog anyway.
  return Date.now();
};

const writeLastSeen = (at: number) => {
  try {
    localStorage.setItem(LAST_SEEN_KEY, String(at));
  } catch {
    /* best-effort */
  }
};

interface StoredNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string | null;
  metadata?: string | null;
  isRead: boolean;
  createdAt: string;
}

/**
 * Mount the notification-to-toast bridge (no visual output of its own).
 */
export function NotificationToaster() {
  const { showToast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('notification');
  // The root layout wraps the popup windows too (toast window, quick capture)
  // — the bridge must only live in the MAIN window, or the popups would run
  // their own SSE handlers/replays and even navigate themselves into a
  // miniature copy of the app.
  const isPopupWindow =
    pathname.startsWith('/notification-toast') || pathname.startsWith('/quick-capture');
  // Newest reminder timestamp already surfaced (live or replayed) — replay
  // only shows what arrived after this. Persisted across page loads (see
  // LAST_SEEN_KEY) so remounts never re-toast already-seen reminders.
  const lastSeenAtRef = useRef(0);
  if (lastSeenAtRef.current === 0 && typeof window !== 'undefined') {
    lastSeenAtRef.current = readLastSeen();
  }

  const displayReminder = (n: {
    title: string;
    message: string;
    link: string | null;
    metadata?: string | null;
  }) => {
    if (isTauri()) {
      void import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke('show_toast_window', {
          title: n.title,
          body: n.message,
          link: n.link,
          memoId: extractMemoId(n.metadata),
        }).catch(() => {}),
      );
      return;
    }
    showToast(
      `${n.title}: ${n.message}`,
      'info',
      n.link
        ? { action: { label: t('open'), onClick: () => router.push(n.link as string) } }
        : undefined,
    );
  };

  useBrowserNotifications({
    enabled: !isPopupWindow,
    onNotification: ({ notification }) => {
      if (TOASTED_TYPES.has(notification.type)) {
        lastSeenAtRef.current = Date.now();
        writeLastSeen(lastSeenAtRef.current);
      }
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

  // Replay-on-reconnect: reminders fired while the SSE link was down (server
  // restart, watchdog blind window, app closed) exist only as unread bell
  // entries — surface the newest one so timed reminders are never silently
  // missed. The bell keeps the full history.
  useEffect(() => {
    if (isPopupWindow) return;
    return sharedEventSource.onConnectionChange((connected) => {
      if (!connected) return;
      void (async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/notifications?limit=10`);
          if (!res.ok) return;
          const list = (await res.json()) as StoredNotification[];
          const cutoff = lastSeenAtRef.current;
          const missed = list.filter(
            (n) =>
              TOASTED_TYPES.has(n.type) &&
              !n.isRead &&
              new Date(n.createdAt).getTime() > cutoff &&
              Date.now() - new Date(n.createdAt).getTime() < REPLAY_WINDOW_MS,
          );
          if (missed.length === 0) return;
          lastSeenAtRef.current = Date.now();
          writeLastSeen(lastSeenAtRef.current);
          // Newest only — a burst of missed reminders would fight over the
          // single toast surface; the rest are one click away in the bell.
          const newest = missed[0];
          if (newest) displayReminder(newest);
        } catch {
          /* non-critical */
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayReminder is stable in practice; re-subscribing per render would double-fire replays
  }, []);

  // Clicking the global toast window lands here: the Rust side focuses the
  // main window and emits the link for the SPA router to open.
  useEffect(() => {
    if (!isTauri() || isPopupWindow) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<string>('rapitas:toast-navigate', (e) => {
        if (e.payload) router.push(e.payload);
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => unlisten?.();
  }, [router, isPopupWindow]);

  return null;
}
