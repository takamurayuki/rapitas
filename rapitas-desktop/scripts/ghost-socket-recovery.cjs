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

module.exports = { GHOST_HOLDER_NAMES, recoverGhostSocket };
