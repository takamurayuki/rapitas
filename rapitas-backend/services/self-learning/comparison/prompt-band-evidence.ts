/**
 * PromptBandEvidence
 *
 * Aggregates a role × model × complexity-band × prompt-version cell's past
 * outcomes into a multi-dimensional difficulty vector (verify failure rate,
 * repair-iteration count, execution time, context length, static verify
 * complexity) plus a duration-prediction-style confidence score. Read-only,
 * on-the-fly aggregation — no new Prisma model (task #970 selected option A:
 * extend existing read-side collectors instead of persisting a new table).
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { ROLE_TROUBLE_CAUSES } from '../../workflow/role-evidence';
import {
  computeConfidence,
  computeMedian,
  nearestRank,
} from '../../workflow/learning/duration-prediction-service';

const log = createLogger('self-learning:prompt-band-evidence');

/** Difficulty band derived from Task.complexityScore (0-100). */
export type ComplexityBand = 'light' | 'standard' | 'comprehensive';

/**
 * Band boundaries (inclusive upper bounds). Deliberately identical to
 * getRecommendedMode's workflowMode thresholds
 * (rapitas-backend/services/workflow/complexity-analyzer/analyzers.ts:282-288)
 * so a task's difficulty band lines up with the 軽量/標準/包括 vocabulary
 * already shown in the UI, per plan.md's 閾値の確定方法.
 */
const BAND_LIGHT_MAX = 35;
const BAND_STANDARD_MAX = 70;

/** Minimum cell sample size before its stats are trusted (same default as role-evidence's minSamples()). */
export const BAND_EVIDENCE_MIN_SAMPLES = 8;

/** In-memory cache entry lifetime (role:model:band:version cells recompute often within a task run). */
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Band a raw complexity score.
 *
 * @param score - Task.complexityScore (0-100). / タスク複雑度スコア
 * @returns The difficulty band. / 難度帯
 */
export function resolveComplexityBand(score: number): ComplexityBand {
  if (score <= BAND_LIGHT_MAX) return 'light';
  if (score <= BAND_STANDARD_MAX) return 'standard';
  return 'comprehensive';
}

/**
 * Count completed-checkbox-style lines (`- [ ]` / `- [x]` / `- [X]`) inside a
 * plan.md's `## 完了条件` section — the static "verify complexity" proxy.
 * Returns 0 (not an error) when the section or its checkboxes are absent, so
 * formatting drift in older plan.md content never breaks the aggregation.
 *
 * @param planContent - plan.md body (WorkflowFile.content). / plan.md本文
 * @returns Checklist-item count, 0 when the section is missing/empty. / チェック項目数
 */
export function extractVerifyComplexity(planContent: string): number {
  const section = planContent.match(/##[ \t]*完了条件[^\n]*\n([\s\S]*?)(?:\n##[ \t]|$)/);
  if (!section) return 0;
  const items = section[1].match(/^-\s*\[[ xX]\]/gm);
  return items ? items.length : 0;
}

/** Half-open time window a single prompt version was in effect for. */
export interface BandVersionRange {
  validFrom: Date;
  validUntil: Date | null;
}

/** Multi-dimensional difficulty vector aggregated for one (role, model, band, version) cell. */
export interface BandEvidence {
  sampleSize: number;
  verifyFailureRate: number;
  avgIterationCount: number;
  avgExecutionTimeMs: number;
  avgInputTokens: number;
  avgVerifyComplexity: number;
  confidenceScore: number;
  /** True when sampleSize < BAND_EVIDENCE_MIN_SAMPLES — do not trust the numbers above. */
  insufficientData: boolean;
}

function insufficientEvidence(sampleSize = 0): BandEvidence {
  return {
    sampleSize,
    verifyFailureRate: 0,
    avgIterationCount: 0,
    avgExecutionTimeMs: 0,
    avgInputTokens: 0,
    avgVerifyComplexity: 0,
    confidenceScore: 0,
    insufficientData: true,
  };
}

const cache = new Map<string, { value: BandEvidence; expiresAt: number }>();

function cacheKey(
  role: string,
  model: string,
  band: ComplexityBand,
  range: BandVersionRange,
): string {
  return `${role}:${model}:${band}:${range.validFrom.toISOString()}:${range.validUntil?.toISOString() ?? 'open'}`;
}

/**
 * Aggregate one (role, model, band, version-window) cell's past outcomes.
 * Fail-open: any query error is logged and degrades to insufficient
 * evidence rather than propagating, so an aggregation failure never blocks
 * the recommendation caller (plan.md エッジケースの方針).
 *
 * @param role - Workflow role (e.g. "implementer"). / ワークフローロール
 * @param model - Model name as recorded on AgentExecution.modelName. / モデル名
 * @param band - Difficulty band to filter tasks by. / 難度帯
 * @param range - Prompt version's [validFrom, validUntil) window. / バージョン有効期間
 * @returns The aggregated difficulty vector. / 集計済み難度ベクトル
 */
export async function computeBandEvidence(
  role: string,
  model: string,
  band: ComplexityBand,
  range: BandVersionRange,
): Promise<BandEvidence> {
  const key = cacheKey(role, model, band, range);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const evidence = await computeBandEvidenceUncached(role, model, band, range);
    cache.set(key, { value: evidence, expiresAt: Date.now() + CACHE_TTL_MS });
    return evidence;
  } catch (error) {
    log.warn({ err: error, role, model, band }, 'band evidence aggregation failed (non-fatal)');
    return insufficientEvidence();
  }
}

async function computeBandEvidenceUncached(
  role: string,
  model: string,
  band: ComplexityBand,
  range: BandVersionRange,
): Promise<BandEvidence> {
  const executions = await prisma.agentExecution.findMany({
    where: {
      modelName: model,
      session: { mode: `workflow-${role}` },
      createdAt: { gte: range.validFrom, ...(range.validUntil ? { lt: range.validUntil } : {}) },
    },
    select: {
      executionTimeMs: true,
      inputTokens: true,
      session: { select: { config: { select: { taskId: true } } } },
    },
  });

  const taskIds = [
    ...new Set(
      executions
        .map((e) => e.session?.config?.taskId)
        .filter((id): id is number => typeof id === 'number'),
    ),
  ];
  if (taskIds.length === 0) return insufficientEvidence();

  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, complexityScore: true },
  });
  // NOTE: complexityScore=null tasks are excluded from both numerator and
  // denominator (plan.md エッジケースの方針) — an undefined band must never
  // be silently folded into a real one.
  const bandTaskIds = new Set(
    tasks
      .filter((t) => t.complexityScore != null && resolveComplexityBand(t.complexityScore) === band)
      .map((t) => t.id),
  );
  if (bandTaskIds.size === 0) return insufficientEvidence();

  const troubleCauses = ROLE_TROUBLE_CAUSES[role] ?? ['verify_repair', 'ci_repair'];
  const troubleRows = await prisma.workflowTransition.findMany({
    where: { taskId: { in: [...bandTaskIds] }, cause: { in: troubleCauses } },
    select: { taskId: true },
  });
  const iterationCounts = new Map<number, number>();
  for (const row of troubleRows) {
    iterationCounts.set(row.taskId, (iterationCounts.get(row.taskId) ?? 0) + 1);
  }

  const planRows = await prisma.workflowFile.findMany({
    where: { taskId: { in: [...bandTaskIds] }, fileType: 'plan' },
    select: { taskId: true, content: true },
  });
  const verifyComplexityByTask = new Map<number, number>();
  for (const row of planRows) {
    verifyComplexityByTask.set(row.taskId, extractVerifyComplexity(row.content));
  }

  const execTimeByTask = new Map<number, number>();
  const inputTokensByTask = new Map<number, number>();
  for (const execution of executions) {
    const taskId = execution.session?.config?.taskId;
    if (typeof taskId !== 'number' || !bandTaskIds.has(taskId)) continue;
    execTimeByTask.set(
      taskId,
      (execTimeByTask.get(taskId) ?? 0) + (execution.executionTimeMs ?? 0),
    );
    inputTokensByTask.set(taskId, (inputTokensByTask.get(taskId) ?? 0) + execution.inputTokens);
  }

  const n = bandTaskIds.size;
  const failedTasks = [...bandTaskIds].filter((id) => (iterationCounts.get(id) ?? 0) > 0).length;
  const execTimes = [...bandTaskIds].map((id) => execTimeByTask.get(id) ?? 0).sort((a, b) => a - b);
  const median = computeMedian(execTimes);
  const p25 = nearestRank(execTimes, 0.25);
  const p75 = nearestRank(execTimes, 0.75);

  const sum = (m: Map<number, number>): number =>
    [...bandTaskIds].reduce((acc, id) => acc + (m.get(id) ?? 0), 0);

  return {
    sampleSize: n,
    verifyFailureRate: n > 0 ? failedTasks / n : 0,
    avgIterationCount: n > 0 ? sum(iterationCounts) / n : 0,
    avgExecutionTimeMs: n > 0 ? sum(execTimeByTask) / n : 0,
    avgInputTokens: n > 0 ? sum(inputTokensByTask) / n : 0,
    avgVerifyComplexity: n > 0 ? sum(verifyComplexityByTask) / n : 0,
    confidenceScore: n > 0 ? computeConfidence(n, median, p25, p75) : 0,
    insufficientData: n < BAND_EVIDENCE_MIN_SAMPLES,
  };
}

/** Test-only: clear the band-evidence cache. */
export function _resetBandEvidenceCache(): void {
  cache.clear();
}
