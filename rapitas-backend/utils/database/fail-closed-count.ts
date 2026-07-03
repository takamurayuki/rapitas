/**
 * Fail-Closed Budget Counter
 *
 * Wraps a Prisma `count(...)` call that feeds a `count >= cap` decision for a
 * bounded retry/repair/bounce loop (e.g. "how many prior CI-repairs has this
 * task had"). Not responsible for counters that are merely display metrics or
 * soft routing signals — only for counts that gate whether a loop is allowed
 * to run another iteration.
 */
import type { createLogger } from '../../config/logger';

/** Minimal logger shape accepted — matches the pino-style logger this project uses everywhere. */
type WarnLogger = Pick<ReturnType<typeof createLogger>, 'warn'>;

/**
 * Await a budget-counter query, but FAIL CLOSED on error instead of the
 * common (and dangerous) `.catch(() => 0)` idiom.
 *
 * Rationale: a cap-based loop guard reads as "keep looping while
 * `count < cap`". A bare `.catch(() => 0)` makes a transient DB error look
 * identical to "no prior attempts" — so every failed count query RESETS the
 * apparent budget to zero, and the guard it was meant to enforce never trips.
 * This project has hit multi-day production spins from exactly this shape
 * (plan-replan loop, CI-repair bounce, auto-merge conflict re-filing, phase
 * critic bounce). Returning `cap` instead makes `count >= cap` true for any
 * caller regardless of the configured threshold, so a DB hiccup makes the
 * loop STOP (and the caller can decide to block/park/notify) rather than
 * spin unboundedly. The one-tick cost is a possible false-positive stop on a
 * purely transient error — a strictly safer failure mode than an unbounded
 * loop that has previously run for days.
 *
 * @param countPromise - The in-flight `prisma.*.count(...)` call. / 実行中のカウントクエリ
 * @param cap - The threshold this count is compared against; returned as-is on error so `count >= cap` holds. / 比較対象の上限値（エラー時はこの値を返す）
 * @param log - Logger to warn on failure (reuse the caller's module logger). / 失敗時にwarnするロガー
 * @param context - Extra fields merged into the warning (taskId, etc). / ログに付与する追加情報
 * @param label - Short identifier for the counter, for the log line. / カウンタ識別用ラベル
 * @returns The real count, or `cap` when the query failed. / 実際のカウント、失敗時は上限値
 */
export async function countWithFailClosed(
  countPromise: Promise<number>,
  cap: number,
  log: WarnLogger,
  context: Record<string, unknown>,
  label: string,
): Promise<number> {
  return countPromise.catch((err: unknown) => {
    log.warn(
      { err, ...context, cap },
      `[fail-closed-count] ${label}: count query failed — treating budget as exhausted (cap=${cap})`,
    );
    return cap;
  });
}
