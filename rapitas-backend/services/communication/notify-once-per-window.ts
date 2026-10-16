/**
 * notify-once-per-window
 *
 * Creates a notification only when an equivalent one was not created recently.
 * Owns the suppression decision and nothing else — it does not decide WHAT is
 * worth notifying, and it never throws.
 *
 * Why it exists: a watcher that re-notifies on every tick trains the reader to
 * ignore it, so three modules each grew their own copy of this query
 * (auto-run-no-selection-watch's two, workflow-reconciler-orphan-flag's one).
 * Those predate this helper and still carry their own; new callers use this one
 * rather than adding a fourth.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';

const log = createLogger('communication:notify-once-per-window');

/** Default suppression window, matching the three existing copies. */
export const DEFAULT_RENOTIFY_WINDOW_MS = 6 * 60 * 60 * 1000;

/** One notification, plus the window it must not repeat inside. */
export interface WindowedNotification {
  title: string;
  message: string;
  /** Also the dedupe key together with `title`. / タイトルと合わせて重複判定キー */
  link: string;
  metadata?: Record<string, unknown>;
  /** Defaults to {@link DEFAULT_RENOTIFY_WINDOW_MS}. / 再通知の抑止窓 */
  windowMs?: number;
  /** Injectable clock. / 現在時刻 */
  nowMs?: number;
}

/**
 * Create the notification unless one with the same title+link exists inside
 * the window.
 *
 * A failed lookup suppresses rather than duplicates: this is an attention
 * signal, and the state it reports persists, so the next pass will raise it
 * again. Duplicating on every transient DB error is how a signal stops being
 * read.
 *
 * @param input - The notification and its window. / 通知内容と抑止窓
 * @returns Whether a notification was created. / 通知を作成したか
 */
export async function notifyOncePerWindow(input: WindowedNotification): Promise<boolean> {
  const nowMs = input.nowMs ?? Date.now();
  const windowMs = input.windowMs ?? DEFAULT_RENOTIFY_WINDOW_MS;
  const recent = await prisma.notification
    .findFirst({
      where: {
        link: input.link,
        title: input.title,
        createdAt: { gt: new Date(nowMs - windowMs) },
      },
      select: { id: true },
    })
    .catch((err: unknown) => {
      log.warn({ err, link: input.link }, '[notify-once] dedupe lookup failed — suppressing');
      return { id: -1 };
    });
  if (recent) return false;

  try {
    const { createNotification } = await import('./notification-service');
    await createNotification({
      type: 'system',
      title: input.title,
      message: input.message,
      link: input.link,
      metadata: input.metadata,
    });
    return true;
  } catch (err) {
    log.warn({ err, link: input.link }, '[notify-once] failed to create the notification');
    return false;
  }
}
