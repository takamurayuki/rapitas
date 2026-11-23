'use strict';
/**
 * ghost-socket-recovery
 *
 * Clears a "ghost" LISTEN socket on the backend port: one whose owning PID is
 * dead but whose handle lives on in a process the backend had spawned
 * (Windows children inherit the listening handle). Not responsible for
 * finding or killing the holders — the caller's `sweep` does that
 * (dev.js `killGhostHandleHolders`); this decides when a sweep is needed and
 * whether it worked.
 *
 * NOTE: A single sweep right after the stop is not enough. On 2026-11-20 the
 * holder was a node.exe whose parent was still alive at that moment, so it
 * was not an orphan yet and survived; dev.js then called the port released
 * and started the new backend beside the ghost.
 */

/**
 * Process names that can hold an inherited backend handle. Shells are in the
 * list because agents start background servers from bash / cmd (the
 * 2026-11-20 holder was an agent's `bash.exe` running `start.bat`).
 */
const GHOST_HOLDER_NAMES =
  /^(find|tail|node|esbuild|vitest|msedge|msedgewebview2|curl|tsc|git|claude|bun|bash|cmd)\.exe$/i;

/**
 * Sweep until the ghost socket is gone, waiting between sweeps so a dying
 * process tree can finish orphaning its children.
 *
 * @param {number} port - Backend port / バックエンドのポート
 * @param {{
 *   isPortListening: (port: number) => boolean,
 *   liveListeningPids: (port: number) => Set<number>,
 *   sweep: (port: number) => void,
 *   sleep: (ms: number) => void,
 *   attempts?: number,
 *   waitMs?: number,
 * }} deps - Port probes, the sweep and a blocking sleep / 依存の注入
 * @returns {{ cleared: boolean, sweeps: number, liveHolders: boolean }}
 *   Whether the port is free, how many sweeps ran, and whether a live
 *   process (not a ghost) holds it / 解放できたか・掃除回数・生存プロセスの有無
 */
function recoverGhostSocket(port, deps) {
  const attempts = deps.attempts ?? 4;
  const waitMs = deps.waitMs ?? 2500;
  let sweeps = 0;
  for (;;) {
    if (!deps.isPortListening(port)) return { cleared: true, sweeps, liveHolders: false };
    // A live owner is a real server, not a ghost — the caller decides what to
    // do with it; sweeping orphans would not free it.
    if (deps.liveListeningPids(port).size > 0) return { cleared: false, sweeps, liveHolders: true };
    if (sweeps >= attempts) return { cleared: false, sweeps, liveHolders: false };
    deps.sweep(port);
    sweeps += 1;
    deps.sleep(waitMs);
  }
}

/**
 * The backend handle to keep once a stop has finished: cleared only when it
 * is still the process this stop was asked to stop.
 *
 * NOTE: The stop awaits the port release for up to 20 s, and a start-retry
 * timer could spawn a new backend in that window. Clearing the handle
 * unconditionally lost that backend, so the next start saw none and spawned a
 * second one — two live backends LISTENING on :3001 (2026-11-23 06:53).
 *
 * @param {object|null} current - The handle now / 現在の backend
 * @param {object|null} stopped - The handle the stop began with / 停止対象だった backend
 * @returns {object|null} The handle to keep / 残す backend
 */
function backendHandleAfterStop(current, stopped) {
  return current === stopped ? null : current;
}

/** Fast retries while a held port is likely to clear on its own (5 minutes at 15 s). */
const FAST_START_RETRIES = 20;
const FAST_START_RETRY_MS = 15000;
/** After that, keep trying once a minute for as long as dev.js runs. */
const SLOW_START_RETRY_MS = 60000;

/**
 * How long to wait before the Nth refused backend start is retried, and
 * whether to tell the operator now.
 *
 * NOTE: dev.js used to give up after 20 refusals. On 2026-11-23 an orphaned
 * runtime preview held :3001 twice for longer than that; once it was stopped
 * the port was free, but nothing retried and the app had to be restarted by
 * hand both times. The retry now never ends, only slows down, and the
 * operator is notified once — when it slows down.
 *
 * @param {number} attempt - 1-based retry number / 何回目の再試行か（1始まり）
 * @returns {{ delayMs: number, notify: boolean }} Delay and whether to notify / 待ち時間と通知の要否
 */
function backendStartRetryPlan(attempt) {
  if (attempt <= FAST_START_RETRIES) return { delayMs: FAST_START_RETRY_MS, notify: false };
  return { delayMs: SLOW_START_RETRY_MS, notify: attempt === FAST_START_RETRIES + 1 };
}

module.exports = {
  GHOST_HOLDER_NAMES,
  recoverGhostSocket,
  backendHandleAfterStop,
  backendStartRetryPlan,
};
