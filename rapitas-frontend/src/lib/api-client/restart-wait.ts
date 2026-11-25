/**
 * restart-wait
 *
 * Lets the API client ride out a backend restart instead of failing: it
 * recognises connection-level errors, polls `/health` until the backend is
 * back (or the 2-minute ceiling passes), and holds mutations while a restart
 * is known to be in progress. Owns the restart-store flag while it waits.
 * Not responsible for issuing the real request or retrying it — client.ts
 * decides that, so a mutation is never sent twice.
 */
import {
  getRestartStartedAt,
  isServerRestarting,
  MAX_RESTART_MS,
  useServerRestartStore,
} from '@/stores/server-restart-store';

/** Gap between two `/health` probes while the backend is down. */
export const HEALTH_POLL_INTERVAL_MS = 1_000;
/** Give up on a single `/health` probe after this long. */
export const HEALTH_PROBE_TIMEOUT_MS = 2_000;

// Connection refused / reset / timed out, across browsers and our own abort
// message. 4xx and 5xx are answers from a live backend and are not included.
const CONNECTION_ERROR_MARKERS = [
  'Failed to fetch', // Chromium
  'NetworkError', // Firefox
  'Load failed', // Safari
  'Request timeout after', // performFetch's own timeout
  'ECONNREFUSED',
  'ECONNRESET',
];

let recovery: Promise<boolean> | null = null;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Whether an error means the backend could not be reached at all.
 *
 * @param err - Error thrown by a fetch / fetchで投げられたエラー
 * @returns True for refused / reset / timed-out connections / 接続系エラーなら真
 */
export function isConnectionError(err: unknown): boolean {
  const messages: string[] = [];
  if (err instanceof Error) {
    messages.push(err.message);
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) messages.push(cause.message);
  } else {
    messages.push(String(err));
  }
  return messages.some((m) => CONNECTION_ERROR_MARKERS.some((marker) => m.includes(marker)));
}

/** One `/health` probe. `ready:false` (warm-up still writing) counts as not back yet. */
async function probeHealth(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { ready?: unknown } | null;
    // An older backend without `ready` is treated as back, so nothing waits forever.
    return body?.ready !== false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One shared probe loop. A success counts only within `deadline`: a backend
 * that answers after the 2-minute ceiling must not trigger a re-send, or the
 * "past 2 minutes the caller gets the error" promise would break.
 */
async function runRecoveryLoop(baseUrl: string, deadline: number): Promise<boolean> {
  let firstProbe = true;
  for (;;) {
    const up = await probeHealth(baseUrl);
    if (up && Date.now() <= deadline) {
      if (isServerRestarting()) useServerRestartStore.getState().setRestarting(false);
      return true;
    }
    // A single blip that the first probe already sees through shows nothing;
    // a failed probe means the backend is really down, so show the overlay.
    if (!up && firstProbe && !isServerRestarting()) {
      useServerRestartStore.getState().setRestarting(true);
    }
    firstProbe = false;
    if (Date.now() >= deadline) {
      if (isServerRestarting()) useServerRestartStore.getState().setRestarting(false);
      return false;
    }
    await sleep(Math.min(HEALTH_POLL_INTERVAL_MS, deadline - Date.now()));
  }
}

/**
 * The deadline for a request that starts waiting now: two minutes from when
 * the restart window opened (the SSE shutdown or the first failed probe), or
 * from now when no window is open. Fixed once per request by the caller.
 *
 * @returns Epoch ms after which the request stops waiting / 待機をやめる時刻（エポックms）
 */
export function restartWaitDeadline(): number {
  return (getRestartStartedAt() ?? Date.now()) + MAX_RESTART_MS;
}

/**
 * Wait until the backend answers `/health` again, but never past `deadline`.
 * Concurrent callers share one probe loop so a recovering backend is not
 * flooded; each caller still judges the outcome against its own deadline.
 *
 * @param baseUrl - API base URL / APIのベースURL
 * @param deadline - Epoch ms after which this caller gives up / この呼び出しの期限
 * @returns True when the backend came back within the deadline / 期限内に復帰したら真
 */
export async function waitForBackendRecovery(baseUrl: string, deadline: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()) + 1);
  });
  try {
    // NOTE: Strict `<`, matching the loop's `>= deadline` exit. With `<=`, at
    // the exact deadline a loop that just gave up would be restarted forever.
    while (Date.now() < deadline) {
      if (!recovery) {
        recovery = runRecoveryLoop(baseUrl, deadline).finally(() => {
          recovery = null;
        });
      }
      if (await Promise.race([recovery, expired])) return Date.now() <= deadline;
      // A loop started by a caller with an earlier deadline gave up; ours may
      // still have time, so the next pass starts a loop with our deadline.
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Outcome of holding a request: nothing to wait for, recovered, or past the deadline. */
export type HoldOutcome = 'none' | 'ready' | 'expired';

/**
 * Hold a request while a restart is known to be in progress; return at once
 * otherwise. The caller decides what `expired` means (send once and return
 * the real result), so the outcome is reported rather than swallowed.
 *
 * @param baseUrl - API base URL / APIのベースURL
 * @param deadline - Epoch ms after which holding stops / 保留をやめる時刻
 * @returns `none`, `ready` or `expired` / 保留の結果
 */
export async function holdUntilBackendReady(
  baseUrl: string,
  deadline: number,
): Promise<HoldOutcome> {
  if (!recovery && !isServerRestarting()) return 'none';
  return (await waitForBackendRecovery(baseUrl, deadline)) ? 'ready' : 'expired';
}

/**
 * Start watching for recovery after a request failed to connect, without
 * waiting. Used for mutations, which are never re-sent: this only shows the
 * overlay and makes the NEXT mutation wait.
 *
 * @param baseUrl - API base URL / APIのベースURL
 */
export function noteConnectionFailure(baseUrl: string): void {
  void waitForBackendRecovery(baseUrl, restartWaitDeadline());
}

/** Drop the shared probe loop (tests only). */
export function resetRestartWaitForTests(): void {
  recovery = null;
}
