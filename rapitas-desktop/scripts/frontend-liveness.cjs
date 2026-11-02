'use strict';
/**
 * frontend-liveness
 *
 * Decides, one check at a time, whether dev.js should bring the frontend dev
 * server back. Pure: dev.js supplies the observations and performs the action.
 *
 * Every earlier recycle trigger (memory, CPU spin, .next drift) watched a
 * process that was alive. When next died outright — 2026-10-22, a Turbopack
 * panic mid-`pnpm install` — port 3000 stayed empty until someone restarted
 * dev.js by hand, which takes the backend down with it (#1230).
 */

/** Defaults; dev.js may override from env. */
const LIVENESS_DEFAULTS = Object.freeze({
  // Matches the time a cold first compile may legitimately leave :3000 empty.
  graceMs: 5 * 60 * 1000,
  // A live process that stops listening gets this many checks before recycle,
  // so a single slow netstat or a momentary rebind does not trigger it.
  missLimit: 2,
  // Restart budget: if `pnpm run dev` itself keeps failing (e.g. a broken
  // install), recycling forever would only spin. Give up and say so.
  maxRestarts: 3,
  windowMs: 30 * 60 * 1000,
});

/** @returns {{misses:number, restarts:number[], reportedExitHeld:boolean, gaveUp:boolean}} */
function initialLiveness() {
  return { misses: 0, restarts: [], reportedExitHeld: false, gaveUp: false };
}

/**
 * Decide what to do after one observation of the frontend.
 *
 * @param {ReturnType<typeof initialLiveness>} state - Carried between checks / 前回までの状態
 * @param {{now:number, startedAt:number, listening:boolean, exited:boolean, busy:boolean}} obs
 *   - `listening`: something LISTENs on the frontend port; `exited`: the process
 *     dev.js spawned has exited; `busy`: a restart or cleanup is in progress / 観測値
 * @param {typeof LIVENESS_DEFAULTS} cfg - Thresholds / しきい値
 * @returns {{state: ReturnType<typeof initialLiveness>, action: 'none'|'restart'|'report'|'give-up', reason?: string}}
 *   The next state and the action dev.js should take / 次の状態と取るべき動作
 */
function nextLiveness(state, obs, cfg = LIVENESS_DEFAULTS) {
  const restarts = state.restarts.filter((t) => obs.now - t < cfg.windowMs);
  const base = { ...state, restarts };
  if (obs.busy) return { state: { ...base, misses: 0 }, action: 'none' };

  if (obs.listening) {
    // Our process gone but the port answered: someone else holds it (#1262).
    // restartFrontend force-kills the port owner, so never recycle into that.
    if (obs.exited && !state.reportedExitHeld) {
      return {
        state: { ...base, misses: 0, reportedExitHeld: true },
        action: 'report',
        reason: 'frontend-exited-port-held',
      };
    }
    return {
      state: { ...base, misses: 0, gaveUp: obs.exited ? state.gaveUp : false },
      action: 'none',
    };
  }

  // A live process still inside its first compile is allowed an empty port.
  if (!obs.exited && obs.now - obs.startedAt < cfg.graceMs) {
    return { state: { ...base, misses: 0 }, action: 'none' };
  }

  const misses = state.misses + 1;
  const limit = obs.exited ? 1 : cfg.missLimit;
  if (misses < limit) return { state: { ...base, misses }, action: 'none' };

  if (restarts.length >= cfg.maxRestarts) {
    if (state.gaveUp) return { state: { ...base, misses }, action: 'none' };
    return {
      state: { ...base, misses, gaveUp: true },
      action: 'give-up',
      reason: 'restart-budget-spent',
    };
  }
  return {
    state: {
      ...base,
      misses: 0,
      restarts: [...restarts, obs.now],
      reportedExitHeld: false,
      gaveUp: false,
    },
    action: 'restart',
    reason: obs.exited ? 'frontend-exited' : 'frontend-not-listening',
  };
}

module.exports = { nextLiveness, initialLiveness, LIVENESS_DEFAULTS };
