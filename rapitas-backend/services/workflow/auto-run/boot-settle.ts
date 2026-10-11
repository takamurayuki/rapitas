/**
 * boot-settle
 *
 * Decides when auto-run may resume after a backend boot, and schedules that
 * resume without delaying boot itself.
 *
 * Why this exists: the backend and the UI's dev server share a 4-core host, and
 * resuming auto-run at boot put the scheduler's work on top of the frontend's
 * warm-up. Measured 2026-10-09 on the restart that prompted this: the backend
 * process sat at 166% of one core and the page was unreachable. Restarting with
 * auto-run quiet and resuming it only after the UI answered gave 16-23% for the
 * same process and an immediate HTTP 200 — so the fix is ordering, not less
 * work. (The same contention produced an 18s event-loop stall that tripped the
 * self-healing restart at 06:00 that day.)
 *
 * NOT responsible for what recovery does (theme-auto-run-scheduler owns that),
 * nor for the stale-queue repair that must still run at boot.
 */

import { createLogger } from '../../../config/logger';

const log = createLogger('workflow:boot-settle');

/**
 * Default quiet period before auto-run resumes.
 *
 * Covers the UI dev server's warm-up on this host rather than a precise
 * measurement of it: the cost being avoided is CONTENTION, so a period that is
 * roughly right removes it, and finishing the wait early buys nothing. Tune it
 * per host with RAPITAS_AUTORUN_BOOT_SETTLE_MS.
 */
export const DEFAULT_BOOT_SETTLE_MS = 60_000;

/** Upper bound, so a typo cannot park auto-run for hours. */
export const MAX_BOOT_SETTLE_MS = 600_000;

/**
 * Resolve the quiet period from the environment.
 *
 * `0` keeps the previous behaviour (resume during boot) and is the documented
 * way to opt out — CI and headless runs have no UI to protect.
 *
 * @param env - Environment to read / 読み取る環境変数
 * @returns Milliseconds to wait, within [0, {@link MAX_BOOT_SETTLE_MS}] / 待機ミリ秒
 */
export function resolveBootSettleMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.RAPITAS_AUTORUN_BOOT_SETTLE_MS ?? '').trim();
  if (raw === '') return DEFAULT_BOOT_SETTLE_MS;
  const parsed = Number(raw);
  // A non-numeric or negative value is a configuration mistake, not an
  // instruction to disable the wait — fall back to the default rather than
  // silently restoring the behaviour this module exists to prevent.
  if (!Number.isFinite(parsed) || parsed < 0) {
    log.warn(
      { value: raw },
      '[bootSettle] RAPITAS_AUTORUN_BOOT_SETTLE_MS is not a non-negative number; using the default',
    );
    return DEFAULT_BOOT_SETTLE_MS;
  }
  return Math.min(Math.floor(parsed), MAX_BOOT_SETTLE_MS);
}

/** Injection seam for tests; mirrors the globals used in production. */
export interface BootSettleDeps {
  settleMs?: number;
  /** Must return a handle whose `unref` is safe to call, like Node's setTimeout. */
  schedule?: (fn: () => void, ms: number) => { unref?: () => void } | number;
}

/**
 * Run `resume` after the quiet period, returning immediately.
 *
 * Boot must not block on this: the warm-up task that calls it also owns
 * stale-queue repair, and holding that for a minute would leave the queue
 * inconsistent for exactly as long. The timer is unref'd so a pending wait can
 * never keep the process alive on shutdown.
 *
 * @param resume - The recovery to run once settled / 落ち着いた後に実行する復帰処理
 * @param deps - Test seams / テスト用の差し替え
 * @returns The delay actually applied, in ms / 実際に適用した遅延
 */
export function deferAutoRunRecovery(
  resume: () => Promise<void>,
  deps: BootSettleDeps = {},
): number {
  const settleMs = deps.settleMs ?? resolveBootSettleMs();
  const run = () => {
    resume().catch((err) => {
      log.warn({ err }, '[bootSettle] Deferred auto-run recovery failed');
    });
  };

  if (settleMs === 0) {
    log.info('[bootSettle] Quiet period disabled — resuming auto-run during boot');
    run();
    return 0;
  }

  log.info(
    `[bootSettle] Holding auto-run recovery for ${Math.round(settleMs / 1000)}s so the UI can warm up`,
  );
  const schedule = deps.schedule ?? setTimeout;
  const handle = schedule(run, settleMs);
  if (typeof handle === 'object' && handle !== null && typeof handle.unref === 'function') {
    handle.unref();
  }
  return settleMs;
}
