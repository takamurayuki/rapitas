/**
 * jury-repair-history
 *
 * Reads the findings of the previous verify_repair bounces in the current
 * repair window and builds the jury bounce reason from them
 * (jury-repair-reason.ts). Read-only; the bounce itself is written by
 * verify-self-repair.ts.
 */
import type { ReviewFinding } from '../agents/verification/review-findings';
import {
  buildJuryRepairReason,
  type PriorJuryRound,
  type RoundFinding,
} from './jury-repair-reason';

/** Minimal DB surface (injectable for tests). */
export interface JuryHistoryDb {
  workflowTransition: {
    findMany: (args: {
      where: Record<string, unknown>;
      select: { metadata: true };
      orderBy: { createdAt: 'desc' };
      take: number;
    }) => Promise<Array<{ metadata: string | null }>>;
  };
}

/** Overrides for the DB and the repair-window boundary. */
export interface JuryHistoryDeps {
  db?: JuryHistoryDb;
  windowStart?: (taskId: number) => Promise<Date | null>;
}

const JURY_REASON_PREFIX = '差分レビュー不合格';

/**
 * Cause of a CI repair bounce. NOTE: Same value as CI_REPAIR_CAUSE in
 * ci-self-repair.ts:28 (a test pins the two); not imported because that module
 * pulls in the whole CI repair stack.
 */
export const CI_REPAIR_CAUSE = 'ci_repair';

function roundOf(metadata: string | null): PriorJuryRound {
  try {
    const meta = JSON.parse(metadata ?? '{}') as { reason?: unknown; findings?: unknown };
    if (typeof meta.reason !== 'string' || !meta.reason.startsWith(JURY_REASON_PREFIX)) return null;
    return Array.isArray(meta.findings)
      ? meta.findings.filter((f): f is RoundFinding => !!f && typeof f === 'object')
      : [];
  } catch {
    return null;
  }
}

/**
 * Load the findings of the two newest verify_repair / ci_repair bounces in the
 * repair window, newest first. A bounce that was not a jury bounce (a CI
 * repair, a machine gate) reads as null: it breaks a run. Never throws: any error reads as no history.
 *
 * @param taskId - Task / 対象タスク
 * @param deps - Optional DB and window overrides / DB と窓の差し替え
 * @returns Up to two rounds / 直近2回分
 */
export async function loadPriorJuryFindingRounds(
  taskId: number,
  deps: JuryHistoryDeps = {},
): Promise<PriorJuryRound[]> {
  try {
    const db = deps.db ?? ((await import('../../config')).prisma as unknown as JuryHistoryDb);
    // A client without the table (a caller's test double) means no history;
    // checked first so the window lookup never reaches another client.
    if (typeof db?.workflowTransition?.findMany !== 'function') return [];
    // Dynamic: some callers' tests replace the budget module with a partial mock.
    const budget = await import('./verify-self-repair-budget');
    const cause = budget.REPAIR_CAUSE ?? 'verify_repair';
    const windowStart = await (deps.windowStart ?? budget.resolveRepairWindowStart)(taskId);
    const rows = await db.workflowTransition.findMany({
      // ci_repair rows are read so a CI bounce in between breaks the run (R3).
      where: {
        taskId,
        cause: { in: [cause, CI_REPAIR_CAUSE] },
        ...(windowStart ? { createdAt: { gt: windowStart } } : {}),
      },
      select: { metadata: true },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    return rows.slice(0, 2).map((r) => roundOf(r.metadata));
  } catch {
    return [];
  }
}

/**
 * Build the jury bounce reason for a task, reading its previous bounces.
 *
 * @param taskId - Task / 対象タスク
 * @param review - The failed review / 不合格のレビュー
 * @param deps - Optional DB and window overrides / DB と窓の差し替え
 * @returns The reason / 差し戻しの理由
 */
export async function buildJuryRepairReasonForTask(
  taskId: number,
  review: { reasons: string[]; findings?: ReadonlyArray<ReviewFinding> },
  deps: JuryHistoryDeps = {},
): Promise<string> {
  return buildJuryRepairReason(review, await loadPriorJuryFindingRounds(taskId, deps));
}
