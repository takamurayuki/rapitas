/**
 * PromptEvolutionSettle
 *
 * Closes the prompt-evolution loop. An approved addendum is injected into a
 * role's prompt (getApprovedRoleAddendum) but, until now, nothing ever
 * measured whether the role got better: every row stayed "approved" forever
 * and completedCount was 0 (autonomy audit 2026-09-06). This module scores
 * the role over the sessions that ran AFTER approval with the same success
 * definition the runner used to flag the role, records the delta, and
 * retires an addendum that made things worse. Not responsible for proposing
 * or approving addenda.
 */
import type { PrismaClient } from '../../generated/prisma-postgres';
import { createLogger } from '../../config/logger';
import { evaluateRole, type RoleEvaluation } from './prompt-evolution-runner';

const log = createLogger('self-learning:prompt-evolution-settle');

/** Sessions after approval needed before a verdict — below this the sample is noise. */
export const SETTLE_MIN_RUNS = 5;
/** Success-rate drop (absolute) at which an addendum is reverted. */
export const SETTLE_REGRESSION_THRESHOLD = -0.05;

export type SettleVerdict = 'insufficient' | 'completed' | 'reverted';

/**
 * Pure decision: given the pre-approval rate and the post-approval evaluation.
 *
 * @param beforeRate - Success rate that triggered the evolution / 承認前の成功率
 * @param after - Post-approval evaluation of the role / 承認後の評価
 * @param minRuns - Minimum post-approval runs / 判定に必要な実行数
 * @param regressionThreshold - Delta at or below which the addendum is reverted / 差し戻し閾値
 * @returns Verdict and the measured delta / 判定と差分
 */
export function decideSettlement(
  beforeRate: number,
  after: Pick<RoleEvaluation, 'totalRuns' | 'successRate'>,
  minRuns: number = SETTLE_MIN_RUNS,
  regressionThreshold: number = SETTLE_REGRESSION_THRESHOLD,
): { verdict: SettleVerdict; delta: number } {
  if (after.totalRuns < minRuns) return { verdict: 'insufficient', delta: 0 };
  const delta = Number((after.successRate - beforeRate).toFixed(4));
  return { verdict: delta <= regressionThreshold ? 'reverted' : 'completed', delta };
}

interface ApprovedRow {
  id: number;
  basePromptKey: string | null;
  evidenceJson: string | null;
}

interface Evidence {
  successRate?: number;
  approvedAt?: string;
  [key: string]: unknown;
}

function parseEvidence(raw: string | null): Evidence {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Evidence) : {};
  } catch {
    return {};
  }
}

/** Minimal Prisma surface the settlement needs (tests pass a fake). */
export interface SettlePrisma {
  promptEvolution: {
    findMany(args: unknown): Promise<ApprovedRow[]>;
    update(args: unknown): Promise<unknown>;
  };
}

/**
 * Settle every approved addendum that has enough post-approval evidence.
 *
 * Rows approved before this module existed carry no approvedAt; they are
 * stamped now (evidence starts accruing from today) rather than judged on
 * sessions that never saw the addendum.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param evaluate - Role evaluator (the runner's, injectable for tests) / ロール評価関数
 * @param now - Clock, injectable for tests / 現在時刻
 * @returns Count of rows settled (completed or reverted) / 判定確定件数
 */
export async function settleApprovedEvolutions(
  prisma: SettlePrisma,
  evaluate: (
    prisma: PrismaClient,
    role: string,
    since: Date,
  ) => Promise<Pick<RoleEvaluation, 'totalRuns' | 'successRate'>> = evaluateRole,
  now: () => Date = () => new Date(),
): Promise<number> {
  const rows = await prisma.promptEvolution.findMany({
    where: { status: 'approved' },
    select: { id: true, basePromptKey: true, evidenceJson: true },
  });
  let settled = 0;
  for (const row of rows) {
    const role = row.basePromptKey?.replace(/^workflow_role_/, '');
    if (!role) continue;
    const evidence = parseEvidence(row.evidenceJson);
    if (!evidence.approvedAt) {
      await prisma.promptEvolution.update({
        where: { id: row.id },
        data: { evidenceJson: JSON.stringify({ ...evidence, approvedAt: now().toISOString() }) },
      });
      continue;
    }
    const beforeRate = typeof evidence.successRate === 'number' ? evidence.successRate : 0;
    let after: Pick<RoleEvaluation, 'totalRuns' | 'successRate'>;
    try {
      after = await evaluate(
        prisma as unknown as PrismaClient,
        role,
        new Date(evidence.approvedAt),
      );
    } catch (err) {
      // Missing evidence must not become a verdict either way.
      log.warn({ err, id: row.id, role }, '[settle] post-approval evaluation failed — skipped');
      continue;
    }
    const { verdict, delta } = decideSettlement(beforeRate, after);
    if (verdict === 'insufficient') continue;
    await prisma.promptEvolution.update({
      where: { id: row.id },
      data: {
        status: verdict,
        performanceDelta: delta,
        evidenceJson: JSON.stringify({
          ...evidence,
          settledAt: now().toISOString(),
          beforeRate,
          afterRate: after.successRate,
          afterRuns: after.totalRuns,
        }),
      },
    });
    settled++;
    log.info(
      { id: row.id, role, verdict, delta, afterRuns: after.totalRuns },
      '[settle] Prompt evolution settled',
    );
  }
  return settled;
}
