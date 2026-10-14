/**
 * task-spend-notice
 *
 * Tells a human when one task's LIFETIME spend crosses a tier. Owns only the
 * notice: it never halts, never changes a task's status, and is not consulted
 * by any gate — the halt axes live in task-iteration-budget.ts.
 *
 * Why a notice and not a lower ceiling. Measured 2026-10-14 over 653 tasks and
 * $7,048.73 of attributed spend (the increment attribution from C1/C4, not the
 * session-cumulative sums that produced two false halts):
 *
 *   per-task spend: median $5.86, p75 $13.86, p90 $28.52, p95 $37.71, max $69.96
 *   >= $15: 153 tasks, 8 unfinished, 1 ever halted on cost
 *   >= $25:  76 tasks, 4 unfinished, 0 ever halted on cost
 *
 * Two things follow. First, the existing $25 cost ceiling has NEVER fired on a
 * task that genuinely crossed $25 — it reads the windowed spend, and a retry /
 * answered question / replan resets the window, so the accumulation is dropped
 * before it reaches the cap. The only two firings were #1160 at $13.13 and
 * #1174 at $17.96, both under half the cap, both caused by the double-counting
 * C1 fixed. Second, halting at a lower number would be wrong: of the 153 tasks
 * past $15, 145 finished. What was missing was not a stricter stop but anyone
 * being told — 12 tasks spent >= $10 and ended unfinished ($306.94 total),
 * sitting in `cancelled`/`todo` with no cost signal recorded anywhere.
 *
 * Why the default tiers are $15/$30. Simulated with this module's own resolver
 * over all 653 tasks' real lifetime spend:
 *
 *   tiers          notices        of tasks   caught of the 12 expensive-unfinished
 *   [25, 50]        76 / 653        12%       4
 *   [15, 30]       153 / 653        23%       8
 *   [10, 25, 50]   224 / 653        34%      12
 *
 * $15 is the figure the measurement asked for and catches two thirds of the
 * target set; 153 notices across the project's whole history is a few a week.
 * Full coverage costs a notice on one task in three, which is why it is the
 * env override and not the default. Note what the table also says: spend alone
 * is a weak predictor at EVERY threshold (145 of the 153 tasks past $15
 * finished fine), so this is a visibility signal, not a verdict — it is why
 * this module notifies and never halts.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';

const log = createLogger('workflow:task-spend-notice');

/** Cause recorded for a notice; also the dedupe record, so the tier is in its metadata. */
export const SPEND_NOTICE_CAUSE = 'task_spend_notice';

/** Default tiers: the figure the measurement asked for, and its double. */
const DEFAULT_TIERS_USD = [15, 30];

/**
 * Tiers (USD, ascending) at which a task's lifetime spend is reported.
 *
 * A malformed override falls back to the defaults rather than to an empty list:
 * a typo must not silently turn the notices off, which is the failure this
 * module exists to end.
 *
 * @returns Ascending tier thresholds. / 昇順の段
 */
export function spendNoticeTiersUsd(): number[] {
  const raw = process.env.RAPITAS_TASK_SPEND_NOTICE_USD;
  if (!raw) return [...DEFAULT_TIERS_USD];
  const parsed = raw
    .split(',')
    .map((part) => parseFloat(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parsed.length > 0 ? parsed.sort((a, b) => a - b) : [...DEFAULT_TIERS_USD];
}

/**
 * The tier to report now, or null when there is nothing new to say.
 *
 * Returns the HIGHEST tier reached rather than the next one above
 * `lastNoticedUsd`: a task that jumps straight past two tiers should produce
 * one notice saying where it actually is, not a $25 notice describing a task
 * that has spent $70.
 *
 * @param lifetimeUsd - Total attributed spend for the task. / タスクの生涯費用
 * @param lastNoticedUsd - Highest tier already reported (0 when none). / 既報の最上段
 * @returns The tier to report, or null. / 通知する段、無ければ null
 */
export function resolveSpendNoticeTier(lifetimeUsd: number, lastNoticedUsd: number): number | null {
  let reached: number | null = null;
  for (const tier of spendNoticeTiersUsd()) {
    if (lifetimeUsd >= tier && tier > lastNoticedUsd) reached = tier;
  }
  return reached;
}

/** Highest tier already recorded for this task, or null when the history is unreadable. */
async function readLastNoticedTier(taskId: number): Promise<number | null> {
  const rows = await prisma.workflowTransition
    .findMany({ where: { taskId, cause: SPEND_NOTICE_CAUSE }, select: { metadata: true } })
    .catch((err: unknown) => {
      log.warn({ err, taskId }, '[spend-notice] notice history unreadable — skipping the notice');
      return null;
    });
  if (rows === null) return null;

  let highest = 0;
  for (const row of rows) {
    const value = typeof row.metadata === 'string' ? safeParse(row.metadata) : row.metadata;
    if (!value || typeof value !== 'object') continue;
    const tier = (value as Record<string, unknown>).tier;
    if (typeof tier === 'number' && tier > highest) highest = tier;
  }
  return highest;
}

/** Parse a JSON metadata column without throwing; SQLite stores it as text. */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Report a task's lifetime spend once per tier.
 *
 * Fails SOFT and never throws: this is an informational path, and an
 * unreadable history must not break the dispatch decision it is called from.
 * That is the opposite of the fail-closed rule the budget counters use, and
 * deliberately so — a missed notice costs visibility for one tick, while a
 * thrown error would cost a dispatch.
 *
 * @param taskId - Task to report on. / 対象タスク
 * @param lifetimeUsd - Total attributed spend (NOT the windowed figure). / 生涯費用
 * @param workflowStatus - Current status, written unchanged on both sides of the row. / 現在のstatus
 * @returns The tier reported, or null when nothing was written. / 通知した段
 */
export async function reportTaskSpendNotice(
  taskId: number,
  lifetimeUsd: number,
  workflowStatus: string | null,
): Promise<number | null> {
  const lastNoticed = await readLastNoticedTier(taskId);
  if (lastNoticed === null) return null;
  const tier = resolveSpendNoticeTier(lifetimeUsd, lastNoticed);
  if (tier === null) return null;

  const spent = lifetimeUsd.toFixed(2);
  log.info({ taskId, tier, lifetimeUsd }, '[spend-notice] lifetime spend crossed a tier');
  // A no-op transition on purpose: the no-progress scan and the halt-side cause
  // filter both read these rows, and a status change here would read as work.
  await recordTransition({
    taskId,
    fromStatus: workflowStatus ?? null,
    toStatus: workflowStatus ?? 'draft',
    actor: 'system',
    cause: SPEND_NOTICE_CAUSE,
    metadata: { tier, lifetimeUsd },
  }).catch(() => {});
  import('../communication/notification-service')
    .then(({ createNotification }) =>
      createNotification({
        type: 'system',
        title: `タスクの費用が $${tier} を超えました`,
        message:
          `タスク #${taskId} の生涯費用が $${spent} に達しました（通知段 $${tier}）。` +
          '自動実行は止めていません。費用に見合う進捗が出ているかを確認してください。',
        link: `/tasks?taskId=${taskId}`,
        metadata: { taskId, tier, lifetimeUsd, reason: SPEND_NOTICE_CAUSE },
      }),
    )
    .catch(() => {});
  return tier;
}

/**
 * Read a task's lifetime spend and report it if it crossed a tier.
 *
 * Swallows every error for the same reason {@link reportTaskSpendNotice} does:
 * the sole caller is the dispatch-time budget evaluation, and a notice must
 * never be able to fail a dispatch. The spend read is imported on demand so
 * this module stays usable from a test that has not mocked the DB config.
 *
 * @param taskId - Task to report on. / 対象タスク
 * @param workflowStatus - Current status, for the recorded row. / 現在のstatus
 * @returns The tier reported, or null. / 通知した段
 */
export async function reportLifetimeSpendNotice(
  taskId: number,
  workflowStatus: string | null,
): Promise<number | null> {
  try {
    const { getTaskSpendUsd } = await import('./task-budget');
    return await reportTaskSpendNotice(taskId, await getTaskSpendUsd(taskId), workflowStatus);
  } catch (err) {
    log.warn({ err, taskId }, '[spend-notice] lifetime spend read failed — skipping the notice');
    return null;
  }
}
