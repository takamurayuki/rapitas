/**
 * claude-cli-timeouts
 *
 * The wall-clock policy for one auxiliary Claude CLI call: the default cap, the
 * ceiling a caller may raise it to, and the deadline handed to the OS launcher.
 *
 * Split out of claude-cli-provider.ts, which crossed the 500-line hard limit.
 * It is NOT responsible for enforcing any of these — the provider owns the
 * timer and the launcher owns its own kill.
 */

// Per-call wall-clock cap. One-shot helper prompts are small; a stuck CLI must
// not hang a background job forever.
const CLI_TIMEOUT_MS = Number(process.env.RAPITAS_AUX_AI_CLI_TIMEOUT_MS) || 120_000;

/** The default cap, exported so callers and tests can reason about it. */
export const DEFAULT_CLI_TIMEOUT_MS = CLI_TIMEOUT_MS;

/**
 * Hard ceiling for a per-call timeout. MAX_CONCURRENT is 2, so an unbounded
 * request from an HTTP-reachable caller would starve every other aux call.
 */
export const MAX_CLI_TIMEOUT_MS = Number(process.env.RAPITAS_AUX_AI_CLI_MAX_TIMEOUT_MS) || 600_000;

/**
 * Margin by which the launcher's deadline exceeds the provider's own timer.
 *
 * Both now derive from the same per-call value, so without a margin whichever
 * wins the race decides the error the caller sees. The provider's timer should
 * win: it reports `Claude CLI timed out after Nms`, where the launcher's kill
 * path only ever surfaces as `exit 124: Auxiliary CLI launcher deadline
 * exceeded`. The launcher stays the backstop for a timer that never ran.
 */
export const LAUNCHER_GRACE_MS = 15_000;

/**
 * Resolve the wall-clock cap for one CLI call.
 *
 * A few callers legitimately need longer than the default: the document-package
 * generator asks for three full markdown documents and measured 109s against a
 * 120s default on 2026-10-08, so it timed out on nearly every attempt and its
 * caller silently fell back to a hardcoded template. Raising the default for
 * everyone would defeat the cap's purpose (a stuck one-shot helper hanging a
 * background job), hence per-call.
 *
 * Only LONGER requests are honoured, and only up to {@link MAX_CLI_TIMEOUT_MS}:
 * a shorter request would make a normally-fine call fail, and the cap is a
 * safety bound rather than a scheduling knob.
 *
 * @param requestedMs - Caller's requested cap, if any. / 呼び出し側の希望上限
 * @returns The cap to apply. / 適用する上限
 */
export function resolveCliTimeoutMs(requestedMs?: number): number {
  if (typeof requestedMs !== 'number' || !Number.isFinite(requestedMs) || requestedMs <= 0) {
    return DEFAULT_CLI_TIMEOUT_MS;
  }
  if (requestedMs <= DEFAULT_CLI_TIMEOUT_MS) return DEFAULT_CLI_TIMEOUT_MS;
  return Math.min(requestedMs, MAX_CLI_TIMEOUT_MS);
}

/**
 * The deadline to give the OS launcher for a call capped at `timeoutMs`.
 *
 * NOTE: until this existed the launcher only read the backend's own
 * `RAPITAS_AUX_AI_CLI_TIMEOUT_MS`, so a call that legitimately asked for longer
 * was still killed at the 120s default — reported 2026-10-12 as document
 * generation failing with `Claude CLI exited 124: Auxiliary CLI launcher
 * deadline exceeded` on every attempt.
 *
 * @param timeoutMs - The resolved per-call cap / 解決済みの呼び出し上限
 * @returns The launcher's deadline / ランチャーに渡す期限
 */
export function launcherDeadlineMs(timeoutMs: number): number {
  return timeoutMs + LAUNCHER_GRACE_MS;
}
