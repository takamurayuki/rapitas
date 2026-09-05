/**
 * incident-signature-repeat-loop
 *
 * Same-cause repeat-loop detector split out of incident-signature-detectors
 * (task 855, that file's ratchet baseline was pinned at the 500-line hard
 * limit with no room left for further repeat-loop changes). Pure and
 * DB-independent, same as its former home — the caller assembles the
 * transition snapshot. NOT responsible for evidence gathering or concern
 * filing.
 */

/** Task statuses that are terminal — a finished task can never be looping. */
const TERMINAL_TASK_STATUSES = new Set(['done', 'cancelled', 'archived', 'completed']);

/** Lookback window for the same-cause repeat-loop detection (default 60m). */
export const REPEAT_LOOP_WINDOW_MS =
  parseInt(process.env.RAPITAS_INCIDENT_LOOP_WINDOW_MS ?? '', 10) || 60 * 60 * 1000;

/** Minimum same-cause transitions within the window to count as a loop (default 3). */
export const REPEAT_LOOP_MIN_COUNT =
  parseInt(process.env.RAPITAS_INCIDENT_LOOP_MIN_COUNT ?? '', 10) || 3;

/**
 * Minimum same-cause invariantViolation transitions within the window to count as a loop
 * (default 2, lower than REPEAT_LOOP_MIN_COUNT) — an invariantViolation is the system itself
 * flagging a contract breach and needs no forgiveness-budget allowance (task 673:
 * 2 `verify_pr_not_created` invariantViolations 70s apart went undetected at minCount=3/window=60m).
 */
export const INVARIANT_REPEAT_LOOP_MIN_COUNT =
  parseInt(process.env.RAPITAS_INCIDENT_INVARIANT_LOOP_MIN_COUNT ?? '', 10) || 2;

/** One workflow transition reduced to what the repeat-loop detector needs. */
export interface RepeatLoopTransition {
  cause: string;
  createdAtMs: number;
  /** Who caused the transition (TransitionActor value, e.g. 'system'/'user'). */
  actor: string;
  /**
   * True when this transition was recorded as an invariant violation (system
   * self-detected contract breach) — feeds an independent, lower-threshold path,
   * see {@link INVARIANT_REPEAT_LOOP_MIN_COUNT}. Optional for backward compat
   * (unset = false / not counted).
   */
  invariantViolation?: boolean;
}

/**
 * Cause prefix for a normal phase handoff (e.g. `phase_completed:implementer`).
 * Only excluded from repeat-loop aggregation when a repair-bounce cause is
 * also present in the window — see the guard below in
 * {@link detectRepeatLoop} for why.
 */
const PHASE_COMPLETED_CAUSE_PREFIX = 'phase_completed:';

/**
 * Cause emitted every time a verify-phase WorkflowFile is saved (status-
 * transition.ts: `cause: file_saved:${fileType}`). Forgiven by its own
 * independent budget — see {@link detectRepeatLoop} — for the same reason
 * `phase_completed:*` is: a healthy repair cycle re-saves verify once per
 * round (task 708 / concern on #674: DEFAULT_MAX_VERIFY_REPAIRS=2 means one
 * initial verify save + up to 2 repair rounds structurally produces 3
 * `file_saved:verify` transitions, which the pre-fix code counted as a loop
 * because only `phase_completed:*` was forgiven, not the paired verify save).
 */
const FILE_SAVED_VERIFY_CAUSE = 'file_saved:verify';

/**
 * Causes that indicate a self-repair bounce (verify/CI sent a phase back for
 * another attempt). Their presence in the window is what tells
 * {@link detectRepeatLoop} that repeated `phase_completed:*` causes are a
 * healthy repair cycle rather than an anomaly — see the guard below.
 */
const REPAIR_BOUNCE_CAUSES = new Set(['verify_repair', 'ci_repair']);

/** True when `cause` is a self-repair bounce cause (verify_repair/ci_repair). */
export function isRepairBounceCause(cause: string): boolean {
  return REPAIR_BOUNCE_CAUSES.has(cause);
}
/**
 * Detects a same-cause repeat loop: the same transition cause firing at least `minCount` times
 * within the trailing window (REPAIR_BOUNCE_CAUSES causes use `repairBounceMinCount` instead — see
 * the task-837 paragraph below). Ties break deterministically by cause name (localeCompare
 * ascending). actor='user' transitions are excluded — manual recovery is intervention, not a loop.
 * Causes prefixed `phase_completed:` are forgiven, but only when a preceding `verify_repair`/
 * `ci_repair` bounce actually re-authorizes that specific firing: transitions are walked in
 * chronological order with a running "forgiveness budget" that starts at 1 (the initial pass,
 * granted only if the window contains at least one bounce at all) and gains 1 for every bounce
 * encountered so far. Each `phase_completed:*` firing spends one unit of budget if available; if
 * the budget is already spent, that firing is a genuine anomaly and is counted (e.g. #607, task
 * 614: 1 implement + 2 verify_repair bounces, each bounce preceding its re-implement, fully
 * explains 3 firings and is not reported as a loop; the same mechanism also explains #616's 1
 * implement + 2 verify_repair bounces — see incident-signature-detectors.repeat-loop-t616.test.ts
 * for the exact replayed transition window). Requiring the bounce to chronologically precede the
 * firing it forgives (rather than just summing bounce counts anywhere in the window) closes a gap
 * where phase_completed churn front-loaded before any bounce — which a same-window bounce cannot
 * causally explain — would otherwise be waved through by coincidental later bounces of a
 * *different* cause (verify_repair and ci_repair combined). A `phase_completed:*` repetition with
 * zero bounces anywhere in the window is never forgiven at all.
 * `file_saved:verify` (see {@link FILE_SAVED_VERIFY_CAUSE}) is forgiven the same way, through its
 * own independent budget running in parallel — a repair cycle emits both a `phase_completed:*` and
 * a `file_saved:verify` per round, and each cause needs its own full budget rather than splitting
 * one shared budget between them (task 708, concern on #674: 1 initial implement + 1 initial
 * verify save + 2 verify_repair bounces, each preceding a re-implement and a re-save, produced 3
 * `phase_completed:implementer` AND 3 `file_saved:verify` firings — see
 * incident-signature-detectors.repeat-loop-t708.test.ts for the replayed window).
 * REPAIR_BOUNCE_CAUSES themselves (`verify_repair`/`ci_repair`, see {@link isRepairBounceCause})
 * are matched against `repairBounceMinCount` instead of `minCount`. This generalizes task 835's
 * `verify_repair`-only budget guard to also cover `ci_repair`: a task that legitimately exhausts
 * its repair budget (e.g. verifyRepairLimit=3 producing exactly 3 `verify_repair` bounces) must
 * not itself be misreported as a loop — only bounces beyond the caller-supplied budget are
 * flagged (task 837).
 * A terminal taskStatus (see TERMINAL_TASK_STATUSES) short-circuits to null — a finished task is
 * not "looping" even if it churned through retry cycles on the way there (mirrors
 * detectStagnation's guard; caught a false positive on #607, which completed 12s before the
 * report).
 *
 * @param input.transitions - Task transitions (any order). / 対象タスクの遷移一覧
 * @param input.nowMs - Current time (ms). / 現在時刻
 * @param input.taskStatus - Current task status; terminal statuses skip detection (undefined = not checked, for backward compatibility). / タスクの現在ステータス（終端状態は検出をスキップ）
 * @param input.windowMs - Window size (default 60m). / 集計窓
 * @param input.minCount - Detection threshold (default 3). / 検出しきい値
 * @param input.invariantMinCount - Detection threshold for invariantViolation-flagged transitions only (default 2, see {@link INVARIANT_REPEAT_LOOP_MIN_COUNT}). / invariantViolation付き遷移専用のしきい値
 * @param input.repairBounceMinCount - Detection threshold for REPAIR_BOUNCE_CAUSES (verify_repair/ci_repair) only; defaults to minCount. Callers pass the effective repair budget + 1, so spending the whole budget is not itself reported as a loop while a true overrun still is (task 837, generalizes task 835's verify_repair-only guard, see isRepairBounceCause). / 修復バウンス系cause専用のしきい値（修復予算+1を渡す）
 * @returns The dominant looping cause + count + which threshold path (`via`) picked it, or null. / 最多ループcause・count・判定経路またはnull
 */
export function detectRepeatLoop(input: {
  transitions: RepeatLoopTransition[];
  nowMs: number;
  taskStatus?: string;
  windowMs?: number;
  minCount?: number;
  invariantMinCount?: number;
  repairBounceMinCount?: number;
}): { cause: string; count: number; via: 'general' | 'invariant' } | null {
  if (input.taskStatus !== undefined && TERMINAL_TASK_STATUSES.has(input.taskStatus)) return null;
  const windowMs = input.windowMs ?? REPEAT_LOOP_WINDOW_MS;
  const minCount = input.minCount ?? REPEAT_LOOP_MIN_COUNT;
  const invariantMinCount = input.invariantMinCount ?? INVARIANT_REPEAT_LOOP_MIN_COUNT;
  // task 837 (generalizes task 835): REPAIR_BOUNCE_CAUSES fire once per repair round, so spending
  // a budget of N legitimately produces N firings — judge it against the caller-resolved budget,
  // not the static min count.
  const repairBounceMinCount = input.repairBounceMinCount ?? minCount;
  const windowStart = input.nowMs - windowMs;

  const windowed = input.transitions
    .filter(
      (t) => t.actor !== 'user' && t.createdAtMs >= windowStart && t.createdAtMs <= input.nowMs,
    )
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  let bounceTotal = 0;
  for (const t of windowed) {
    if (REPAIR_BOUNCE_CAUSES.has(t.cause)) bounceTotal += 1;
  }

  let forgivenessBudget = bounceTotal > 0 ? 1 : 0;
  let verifyForgivenessBudget = bounceTotal > 0 ? 1 : 0;
  const counts = new Map<string, number>();
  for (const t of windowed) {
    if (REPAIR_BOUNCE_CAUSES.has(t.cause)) {
      forgivenessBudget += 1;
      verifyForgivenessBudget += 1;
      counts.set(t.cause, (counts.get(t.cause) ?? 0) + 1);
      continue;
    }
    if (t.cause.startsWith(PHASE_COMPLETED_CAUSE_PREFIX) && forgivenessBudget > 0) {
      forgivenessBudget -= 1;
      continue;
    }
    if (t.cause === FILE_SAVED_VERIFY_CAUSE && verifyForgivenessBudget > 0) {
      verifyForgivenessBudget -= 1;
      continue;
    }
    counts.set(t.cause, (counts.get(t.cause) ?? 0) + 1);
  }

  // Independent invariantViolation counting path (task 673): raw per-cause
  // counts of ONLY the transitions the system itself flagged as an invariant
  // breach, bypassing forgivenessBudget entirely — a repeat verify_repair/
  // ci_repair bounce should not "spend" budget that excuses a genuine
  // contract violation from detection.
  const invariantCounts = new Map<string, number>();
  for (const t of windowed) {
    if (t.invariantViolation === true) {
      invariantCounts.set(t.cause, (invariantCounts.get(t.cause) ?? 0) + 1);
    }
  }

  let best: { cause: string; count: number; via: 'general' | 'invariant' } | null = null;
  for (const [cause, count] of counts) {
    if (count < (REPAIR_BOUNCE_CAUSES.has(cause) ? repairBounceMinCount : minCount)) continue;
    if (
      best === null ||
      count > best.count ||
      (count === best.count && cause.localeCompare(best.cause) < 0)
    ) {
      best = { cause, count, via: 'general' };
    }
  }
  for (const [cause, count] of invariantCounts) {
    if (count < invariantMinCount) continue;
    if (
      best === null ||
      count > best.count ||
      (count === best.count && cause.localeCompare(best.cause) < 0)
    ) {
      best = { cause, count, via: 'invariant' };
    }
  }
  return best;
}
