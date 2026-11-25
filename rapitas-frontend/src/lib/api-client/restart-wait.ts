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

async function runRecoveryLoop(baseUrl: string): Promise<boolean> {
  // Fixed once: the store forgets restartStartedAt when its own 2-minute timer
  // clears the flag, and re-reading it then would restart the ceiling.
  const startedAt = getRestartStartedAt() ?? Date.now();
  let firstProbe = true;
  for (;;) {
    if (await probeHealth(baseUrl)) {
      if (isServerRestarting()) useServerRestartStore.getState().setRestarting(false);
      return true;
    }
    // A single blip that the first probe already sees through shows nothing;
    // a failed probe means the backend is really down, so show the overlay.
    if (firstProbe) {
      firstProbe = false;
      if (!isServerRestarting()) useServerRestartStore.getState().setRestarting(true);
    }
    if (Date.now() - startedAt >= MAX_RESTART_MS) {
      if (isServerRestarting()) useServerRestartStore.getState().setRestarting(false);
      return false;
    }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
}

/**
 * Wait until the backend answers `/health` again. Concurrent callers share one
 * probe loop so a recovering backend is not flooded.
 *
 * @param baseUrl - API base URL / APIのベースURL
 * @returns True when the backend is back, false once the 2-minute ceiling passed / 復帰したら真、上限超過で偽
 */
export function waitForBackendRecovery(baseUrl: string): Promise<boolean> {
  if (!recovery) {
    recovery = runRecoveryLoop(baseUrl).finally(() => {
      recovery = null;
    });
  }
  return recovery;
}

/**
 * Hold a request while a restart is known to be in progress; return at once
 * otherwise. The outcome is not reported: past the ceiling the request is sent
 * anyway and its real result (or error) goes to the caller.
 *
 * @param baseUrl - API base URL / APIのベースURL
 */
export async function holdUntilBackendReady(baseUrl: string): Promise<void> {
  if (!recovery && !isServerRestarting()) return;
  await waitForBackendRecovery(baseUrl);
}

/**
 * Start watching for recovery after a request failed to connect, without
 * waiting. Used for mutations, which are never re-sent: this only shows the
 * overlay and makes the NEXT mutation wait.
 *
 * @param baseUrl - API base URL / APIのベースURL
 */
export function noteConnectionFailure(baseUrl: string): void {
  void waitForBackendRecovery(baseUrl);
}

/** Drop the shared probe loop (tests only). */
export function resetRestartWaitForTests(): void {
  recovery = null;
}
