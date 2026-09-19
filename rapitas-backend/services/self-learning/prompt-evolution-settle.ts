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
import { readComparisonRecord, writeComparisonRecord } from './comparison/prompt-comparison-store';
import { computeTreeConfidence, type SignificanceLevel } from './prompt-evolution-tree';

const log = createLogger('self-learning:prompt-evolution-settle');

/**
 * Environment escape hatch for low-risk auto-promotion (default OFF — a
 * human must always clear `stagedTaskIds` manually unless this is set).
 * / 低リスク自動昇格の有効化フラグ（既定オフ）
 */
function autoPromoteEnabled(): boolean {
  return process.env.RAPITAS_PROMPT_AUTO_PROMOTE === 'true';
}

/**
 * Whether an addendum text reads as a pure addition rather than an
 * instruction to remove/replace existing agent behavior. The addendum
 * mechanism itself only ever APPENDS to the engineered role prompt (see
 * module doc) — `beforePrompt` is never populated to diff against — so this
 * is a conservative textual guard against an LLM-authored addendum that
 * tells the agent to strip out existing behavior, not a full diff.
 *
 * @param addendum - Approved addendum text. / 承認済み追記文
 * @returns True when no deletion-signal keywords are present. / 削除を示す語が無ければtrue
 */
export function isPureAddendum(addendum: string): boolean {
  return !/削除|除去|取り除|remove|delete/i.test(addendum);
}

/** Sessions after approval needed before a verdict — below this the sample is noise. */
export const SETTLE_MIN_RUNS = 5;
/** Success-rate drop (absolute) at which an addendum is reverted. */
export const SETTLE_REGRESSION_THRESHOLD = -0.05;

export type SettleVerdict = 'insufficient' | 'completed' | 'reverted';

/** Minimum samples in a day/model bucket before its success rate is trusted (matches COMPARISON_MIN_SAMPLE). */
export const CONDITION_MIN_SAMPLES = 5;
/** A bucket's success rate must exceed the overall rate by this margin to be recorded as a condition. */
export const CONDITION_SUCCESS_MARGIN = 0.1;

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** One post-approval execution sample used for day-of-week / model-version condition aggregation. */
export interface ConditionSample {
  createdAt: Date | string;
  modelName: string | null;
  success: boolean;
}

interface ConditionsResult {
  dayOfWeek: string[] | null;
  modelVersion: string[] | null;
  userSegment: null;
}

/**
 * Aggregate post-approval samples by day-of-week and model name, recording an
 * axis value only when its bucket has enough samples (CONDITION_MIN_SAMPLES)
 * AND its success rate beats the overall rate by CONDITION_SUCCESS_MARGIN —
 * see plan.md "適用条件の集計方針". `userSegment` is always null: the product
 * runs single-user (userId=1 fixed calls throughout), so there is no
 * meaningful per-segment signal to aggregate (see plan.md's "ユーザー層" note).
 *
 * @param samples - Post-approval execution outcomes. / 承認後の実行結果
 * @param overallSuccessRate - The role's overall post-approval success rate. / 全体の成功率
 * @returns Conditions under which the addendum performed significantly better. / 条件別の効果
 */
export function aggregateApplicableConditions(
  samples: ConditionSample[],
  overallSuccessRate: number,
): ConditionsResult {
  if (samples.length === 0) return { dayOfWeek: null, modelVersion: null, userSegment: null };

  const byDay = new Map<string, { success: number; total: number }>();
  const byModel = new Map<string, { success: number; total: number }>();
  for (const s of samples) {
    const day = DAY_KEYS[new Date(s.createdAt).getDay()];
    const dayAgg = byDay.get(day) ?? { success: 0, total: 0 };
    dayAgg.total += 1;
    if (s.success) dayAgg.success += 1;
    byDay.set(day, dayAgg);

    const model = s.modelName?.trim();
    if (model) {
      const modelAgg = byModel.get(model) ?? { success: 0, total: 0 };
      modelAgg.total += 1;
      if (s.success) modelAgg.success += 1;
      byModel.set(model, modelAgg);
    }
  }

  const pickSignificant = (
    buckets: Map<string, { success: number; total: number }>,
  ): string[] | null => {
    const winners = [...buckets.entries()]
      .filter(([, agg]) => agg.total >= CONDITION_MIN_SAMPLES)
      .filter(([, agg]) => agg.success / agg.total >= overallSuccessRate + CONDITION_SUCCESS_MARGIN)
      .map(([key]) => key);
    return winners.length > 0 ? winners : null;
  };

  return {
    dayOfWeek: pickSignificant(byDay),
    modelVersion: pickSignificant(byModel),
    userSegment: null,
  };
}

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
  afterPrompt: string;
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
  /** Optional: absent in older fakes/pre-restart clients — condition aggregation is skipped without it. */
  agentExecution?: {
    findMany(args: unknown): Promise<ConditionSample[]>;
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
    scopeTaskIds?: number[],
  ) => Promise<Pick<RoleEvaluation, 'totalRuns' | 'successRate'>> = evaluateRole,
  now: () => Date = () => new Date(),
): Promise<number> {
  const rows = await prisma.promptEvolution.findMany({
    where: { status: 'approved' },
    select: { id: true, basePromptKey: true, evidenceJson: true, afterPrompt: true },
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
    // A candidate limited to a comparison's stagedTaskIds is judged only on
    // those tasks — evaluating the whole role would dilute the signal with
    // tasks that never saw the addendum. Unstaged candidates (no comparison
    // record, or stagedTaskIds cleared) fall back to the original role-wide
    // evaluation.
    const comparison = readComparisonRecord(row.id);
    const stagedTaskIds = comparison?.stagedTaskIds ?? null;
    const beforeRate = typeof evidence.successRate === 'number' ? evidence.successRate : 0;
    let after: Pick<RoleEvaluation, 'totalRuns' | 'successRate'>;
    try {
      after = await evaluate(
        prisma as unknown as PrismaClient,
        role,
        new Date(evidence.approvedAt),
        stagedTaskIds ?? undefined,
      );
    } catch (err) {
      // Missing evidence must not become a verdict either way.
      log.warn({ err, id: row.id, role }, '[settle] post-approval evaluation failed — skipped');
      continue;
    }
    const { verdict, delta } = decideSettlement(beforeRate, after);
    if (verdict === 'insufficient') continue;

    // Node attributes 3/5 (A/B) and 4/5 (conditions) — see plan.md "有意性・
    // 信頼度" and "適用条件の集計方針". abComparisonRef reuses the row's own id
    // (ComparisonRecord.promptEvolutionId), the join key confirmed in
    // prompt-comparison-types.ts.
    const abTested = comparison !== null;
    const significanceLevel = comparison?.summary?.uncertainty ?? null;
    const abComparisonRef = abTested ? String(row.id) : null;
    // treeConfidence is a derived cache (plan.md "有意性・信頼度の算出方針") —
    // recomputed on every settle, since abTested/significanceLevel/status
    // (the confidence rule's inputs) all change here.
    const treeConfidence = computeTreeConfidence({
      abTested,
      significanceLevel: significanceLevel as SignificanceLevel | null,
      status: verdict,
    });
    let applicableConditionsJson: string | null = null;
    if (prisma.agentExecution) {
      try {
        const samples = await prisma.agentExecution.findMany({
          where: {
            createdAt: { gte: new Date(evidence.approvedAt) },
            session: {
              mode: `workflow-${role}`,
              ...(stagedTaskIds ? { config: { taskId: { in: stagedTaskIds } } } : {}),
            },
          },
          select: { createdAt: true, modelName: true, status: true },
        });
        const withSuccess = (
          samples as unknown as Array<{
            createdAt: Date | string;
            modelName: string | null;
            status: string;
          }>
        ).map((s) => ({
          createdAt: s.createdAt,
          modelName: s.modelName,
          success: s.status === 'completed',
        }));
        applicableConditionsJson = JSON.stringify(
          aggregateApplicableConditions(withSuccess, after.successRate),
        );
      } catch (err) {
        log.warn({ err, id: row.id, role }, '[settle] condition aggregation failed — skipped');
      }
    }

    await prisma.promptEvolution.update({
      where: { id: row.id },
      data: {
        status: verdict,
        performanceDelta: delta,
        abTested,
        significanceLevel,
        abComparisonRef,
        treeConfidence,
        ...(applicableConditionsJson ? { applicableConditionsJson } : {}),
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

    // Low-risk auto-promotion: only when a staged rollout was CONFIRMED good
    // in the field (verdict==='completed', not merely the initial shadow
    // comparison), the original comparison already called it 'improved', and
    // the addendum reads as a pure addition. Default OFF — without the env
    // var this block never runs, so a human must always clear stagedTaskIds.
    if (
      verdict === 'completed' &&
      stagedTaskIds !== null &&
      autoPromoteEnabled() &&
      comparison?.summary?.verdict === 'improved' &&
      isPureAddendum(row.afterPrompt)
    ) {
      writeComparisonRecord({ ...comparison, stagedTaskIds: null });
      log.info(
        { id: row.id, role },
        '[settle] Low-risk auto-promotion: staged candidate promoted to full rollout',
      );
    }

    log.info(
      { id: row.id, role, verdict, delta, afterRuns: after.totalRuns },
      '[settle] Prompt evolution settled',
    );
  }
  return settled;
}
