/**
 * performFetch
 *
 * The single HTTP attempt behind APIClient: timeout, caller-signal
 * composition, credentials, the X-Rapitas-Source tag and error annotation.
 * Not responsible for retrying or waiting out a restart — see client.ts and
 * restart-wait.ts. Split out of client.ts to keep that file within size limits.
 */
import { offlineFetch } from '@/lib/offline-queue';
import { createLogger } from '@/lib/logger';
import { resolveUiSourceValue } from '@/lib/api-headers';
import type { RequestOptions } from './types';

const logger = createLogger('api-client');

/**
 * Hard ceiling on any single API request. Without a cap, a stalled
 * connection (backend deadlock, dropped TCP keep-alive, etc.) leaves the
 * promise hanging forever. The same promise is then returned by the
 * in-flight dedup map, so EVERY subsequent caller for the same path also
 * hangs — which is exactly the "task detail page stays in loading state
 * until server restart" symptom users reported. Restarting the backend
 * forced TCP RST → fetch finally rejected → queue cleared → recovery.
 *
 * 30s is generous enough for legitimately slow workflow endpoints but
 * short enough that a recoverable hang surfaces as an actionable error.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Marks requests from this client as UI-originated so the backend's
 * ui-activity-tracker can defer boundary self-restarts while the user is
 * actively operating the UI. Mutations send `ui`; reads send `ui-poll` unless
 * the caller passes `userAction: true` (resolveUiSourceValue, task 1548).
 *
 * NOTE: Values must mirror UI_SOURCE_HEADER / UI_SOURCE_VALUE in
 * rapitas-backend/services/scheduling/auto-restart-merged-code/ui-activity-tracker.ts
 * — the backend constants cannot be imported across packages.
 */
export const UI_SOURCE_HEADER = 'X-Rapitas-Source';
export const UI_SOURCE_VALUE = 'ui';

/** "GET /path?query" for log lines and error messages. */
function labelOf(method: string, url: string): string {
  try {
    return `${method} ${new URL(url).pathname}${new URL(url).search}`;
  } catch {
    return `${method} ${url}`;
  }
}

/**
 * Low-level fetch with auth credentials and JSON content-type.
 *
 * Uses `offlineFetch` from lib/offline-queue so that write requests
 * (POST/PUT/PATCH/DELETE) are queued in IndexedDB when the browser is
 * offline and replayed when it comes back. GET requests pass through to
 * native fetch — they are not queued.
 *
 * When a mutation is queued offline, `offlineFetch` returns a synthetic
 * `202 Accepted` with body `{ queued: true }`, which is returned as `T`.
 *
 * @param url - Full URL / 完全なURL
 * @param options - Fetch options / フェッチオプション
 * @param timeoutMs - Abort after this many ms / タイムアウト（ミリ秒）
 * @returns Parsed JSON response / パース済みJSONレスポンス
 * @throws {Error} On non-2xx responses or transport failures / 2xx以外・通信失敗時
 */
export async function performFetch<T>(
  url: string,
  options: RequestOptions,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const requestStartedAt = Date.now();
  const method = (options.method || 'GET').toUpperCase();
  const requestLabel = labelOf(method, url);

  // Compose any caller-provided AbortSignal with our timeout signal so
  // either source can cancel the request. AbortSignal.any is in modern
  // browsers; fall back to manual chaining when unavailable.
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    // Surface BOTH the URL and the elapsed time so the user can find
    // which endpoint stalled without diving into devtools network tab.
    const elapsed = Date.now() - requestStartedAt;
    const msg = `Request timeout after ${elapsed}ms — ${requestLabel}`;

    // A timeout is a transient transport failure. Group the warning across
    // endpoints for one minute; the caller still receives the full error.
    logger.warnThrottled('[api-client] timeout', requestLabel);
    timeoutController.abort(new Error(msg));
  }, timeoutMs);

  let signal: AbortSignal = timeoutController.signal;
  const callerSignal = (options as RequestOptions & { signal?: AbortSignal }).signal;
  if (callerSignal) {
    const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
    if (typeof anyFn === 'function') {
      signal = anyFn([timeoutController.signal, callerSignal]);
    } else if (callerSignal.aborted) {
      timeoutController.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener('abort', () => timeoutController.abort(callerSignal.reason));
    }
  }

  // `userAction` only picks the header; it is not a RequestInit field.
  const { userAction, ...init } = options;
  const fetchInit: RequestInit = {
    ...init,
    signal,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      [UI_SOURCE_HEADER]: resolveUiSourceValue(method, { userAction }),
      ...options.headers,
    },
  };

  try {
    // NOTE: offlineFetch relies on IndexedDB and navigator.onLine which
    // only exist in the browser. During SSR (Next.js server components)
    // fall back to native fetch — offline queuing is a client-only concern.
    let response: Response;
    if (typeof window !== 'undefined') {
      const pathname = (() => {
        try {
          return new URL(url).pathname;
        } catch {
          return url;
        }
      })();
      response = await offlineFetch(url, fetchInit, `${method} ${pathname}`);
    } else {
      response = await fetch(url, fetchInit);
    }

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`API Error: ${response.status} (${requestLabel}) - ${error}`);
    }

    return response.json();
  } catch (err) {
    // Annotate ANY thrown error (including AbortError from non-timeout
    // sources) with the request label so it surfaces in the UI toast
    // / console rather than appearing as a bare "AbortError".
    if (err instanceof Error && !err.message.includes(requestLabel)) {
      const annotated = new Error(`${err.message} — ${requestLabel}`);
      annotated.stack = err.stack;
      (annotated as Error & { cause?: unknown }).cause = err;
      throw annotated;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
