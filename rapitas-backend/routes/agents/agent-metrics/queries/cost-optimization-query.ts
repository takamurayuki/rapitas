/**
 * Cost Optimization Query
 *
 * Provides getCostOptimizationInsights, which compares per-model execution
 * cost and suggests cheaper substitutes. Cost-per-execution prefers the
 * recorded `AgentExecution.costUsd` (parsed from the CLI's stream-json usage
 * block — the authoritative figure shown everywhere else, e.g. the
 * self-observation summary and agent-usage-summary routes) and only falls
 * back to the hardcoded per-1k-token rate table below when no recorded cost
 * exists (legacy rows from before cost recording was added). This keeps the
 * number on this endpoint identical to the number shown elsewhere for the
 * same execution, instead of silently re-deriving a second, drifting figure
 * from a rate table that goes stale as provider pricing changes.
 */

import { prisma } from '../../../../config/database';
import { toNumber, toInt } from '../metric-coercion';

/** Per-model breakdown of execution cost, volume, and success rate. */
export interface ModelCostStats {
  model: string;
  executions: number;
  successCount: number;
  successRate: number;
  totalTokens: number;
  avgTokens: number;
  avgTimeMs: number;
  estimatedCost: number;
}

export interface CostOptimizationInsights {
  totalCost: number;
  totalTokens: number;
  totalExecutions: number;
  modelBreakdown: ModelCostStats[];
  suggestions: string[];
}

type ComplexityBand = 'low' | 'medium' | 'high';

interface ComparableExecution {
  status: string;
  modelName: string | null;
  tokensUsed: unknown;
  costUsd: unknown;
  executionTimeMs: unknown;
  session?: {
    mode: string | null;
    config: { task: { complexityScore: number | null } };
  } | null;
}

interface SegmentModelStats {
  role: string;
  complexityBand: ComplexityBand;
  model: string;
  executions: number;
  successCount: number;
  totalCost: number;
}

const MIN_COMPARABLE_EXECUTIONS = 5;
const MAX_SUCCESS_RATE_DROP_POINTS = 5;

/**
 * Fallback rate table (USD per 1K tokens, blended input+output estimate).
 * Only used when an execution has no recorded `costUsd` — e.g. rows written
 * before cost recording landed. Keep in sync with provider pricing pages;
 * going stale only affects the fallback, never rows with a recorded cost.
 */
const FALLBACK_COST_PER_1K_TOKENS: Record<string, number> = {
  'claude-opus-4-20250514': 0.025,
  'claude-sonnet-4-20250514': 0.006,
  'claude-haiku-4-5-20251001': 0.002,
  'claude-3-5-sonnet-20241022': 0.006,
  default: 0.01,
};

/**
 * Resolve the USD cost of a single execution: prefer the recorded value,
 * fall back to the rate-table estimate only when nothing was recorded.
 *
 * @param recordedCostUsd - `AgentExecution.costUsd` (Prisma Decimal) / 記録済みコスト
 * @param tokensUsed - `AgentExecution.tokensUsed` / 使用トークン数
 * @param modelId - Model id used for the fallback rate lookup / フォールバック用モデルID
 * @returns Cost in USD / 実行コスト（USD）
 */
function resolveExecutionCost(
  recordedCostUsd: unknown,
  tokensUsed: number,
  modelId: string,
): number {
  // toNumber (shared with usage-breakdown-query) survives the double-JSON
  // encoding some legacy costUsd rows carry from a past IPC bug.
  const recorded = toNumber(recordedCostUsd);
  if (Number.isFinite(recorded) && recorded > 0) return recorded;
  const rate = FALLBACK_COST_PER_1K_TOKENS[modelId] ?? FALLBACK_COST_PER_1K_TOKENS['default'];
  return (tokensUsed / 1000) * rate;
}

/**
 * Compares recent executions grouped by the model actually invoked and
 * suggests cheaper substitutes where success rate is not meaningfully worse.
 *
 * Groups by `AgentExecution.modelName` (the model the CLI actually ran,
 * recorded from the stream-json usage block) — NOT `agentConfig.modelId`,
 * which is the statically-configured model and is identical across rows once
 * Smart Router / auto selection is in play, collapsing every execution into
 * one bucket. Failed and null-model rows are intentionally NOT filtered out:
 * `successRate` is `completed` count over the full denominator, so excluding
 * failures would pin every model at 100% and starve the suggestion engine.
 *
 * @returns Cost optimization insights / コスト最適化インサイト
 */
export async function getCostOptimizationInsights(): Promise<CostOptimizationInsights> {
  // Mirror usage-breakdown-query's fetch path: select modelName directly and
  // skip status/token pre-filters so failures and null-model rows still count.
  const executions = await prisma.agentExecution.findMany({
    select: {
      status: true,
      modelName: true,
      tokensUsed: true,
      costUsd: true,
      executionTimeMs: true,
      session: {
        select: {
          mode: true,
          config: { select: { task: { select: { complexityScore: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const modelMap = new Map<
    string,
    { total: number; success: number; tokens: number; time: number; costs: number }
  >();

  for (const exec of executions) {
    const model = exec.modelName ?? 'unknown';
    const tokens = toInt(exec.tokensUsed);
    const cost = resolveExecutionCost(exec.costUsd, tokens, model);

    const existing = modelMap.get(model) || {
      total: 0,
      success: 0,
      tokens: 0,
      time: 0,
      costs: 0,
    };
    existing.total++;
    if (exec.status === 'completed') existing.success++;
    existing.tokens += tokens;
    existing.time += toInt(exec.executionTimeMs);
    existing.costs += cost;
    modelMap.set(model, existing);
  }

  const modelStats: ModelCostStats[] = Array.from(modelMap.entries()).map(([model, s]) => ({
    model,
    executions: s.total,
    successCount: s.success,
    successRate: s.total > 0 ? Math.round((s.success / s.total) * 100) : 0,
    totalTokens: s.tokens,
    avgTokens: s.total > 0 ? Math.round(s.tokens / s.total) : 0,
    avgTimeMs: s.total > 0 ? Math.round(s.time / s.total) : 0,
    estimatedCost: Math.round(s.costs * 100) / 100,
  }));

  const suggestions = buildSegmentSuggestions(executions as ComparableExecution[]);

  const totalCost = modelStats.reduce((sum, s) => sum + s.estimatedCost, 0);
  const totalTokens = modelStats.reduce((sum, s) => sum + s.totalTokens, 0);

  return {
    totalCost: Math.round(totalCost * 100) / 100,
    totalTokens,
    totalExecutions: executions.length,
    modelBreakdown: modelStats,
    suggestions,
  };
}

/**
 * Generates human-readable cost-saving suggestions by comparing the most
 * expensive model against a cheaper one with comparable success rate.
 *
 * @param modelStats - Per-model cost stats / モデル別コスト統計
 * @returns Suggestion strings (Japanese) / 提案文（日本語）
 */
export function buildLegacySuggestions(modelStats: ModelCostStats[]): string[] {
  const suggestions: string[] = [];
  const sorted = [...modelStats].sort((a, b) => b.estimatedCost - a.estimatedCost);

  if (sorted.length >= 2) {
    const expensive = sorted[0];
    const cheaper = sorted.find(
      (s) => s.model !== expensive.model && s.successRate >= expensive.successRate * 0.9,
    );
    if (cheaper) {
      const savings = expensive.estimatedCost - cheaper.estimatedCost;
      suggestions.push(
        `${expensive.model}の代わりに${cheaper.model}を使用すると、成功率を維持しながら$${savings.toFixed(2)}の削減が見込めます`,
      );
    }
  }

  return suggestions;
}

/** Build recommendations only from executions with the same role and complexity band. */
function buildSegmentSuggestions(executions: ComparableExecution[]): string[] {
  const segmentMap = new Map<
    string,
    { role: string; complexityBand: ComplexityBand; models: Map<string, SegmentModelStats> }
  >();

  for (const exec of executions) {
    const role = workflowRole(exec.session?.mode);
    const complexityBand = toComplexityBand(exec.session?.config.task.complexityScore);
    if (!role || !complexityBand || !exec.modelName) continue;

    const segmentKey = `${role}:${complexityBand}`;
    const segment = segmentMap.get(segmentKey) ?? {
      role,
      complexityBand,
      models: new Map<string, SegmentModelStats>(),
    };
    const stats = segment.models.get(exec.modelName) ?? {
      role,
      complexityBand,
      model: exec.modelName,
      executions: 0,
      successCount: 0,
      totalCost: 0,
    };
    const tokens = toInt(exec.tokensUsed);
    stats.executions++;
    if (exec.status === 'completed') stats.successCount++;
    stats.totalCost += resolveExecutionCost(exec.costUsd, tokens, exec.modelName);
    segment.models.set(exec.modelName, stats);
    segmentMap.set(segmentKey, segment);
  }

  const suggestions: { savings: number; text: string }[] = [];
  for (const segment of segmentMap.values()) {
    const candidates = [...segment.models.values()]
      .filter((stats) => stats.executions >= MIN_COMPARABLE_EXECUTIONS)
      .map((stats) => ({
        ...stats,
        successRate: (stats.successCount / stats.executions) * 100,
        avgCost: stats.totalCost / stats.executions,
      }));

    for (const current of candidates) {
      const alternative = candidates
        .filter(
          (candidate) =>
            candidate.model !== current.model &&
            candidate.avgCost < current.avgCost &&
            candidate.successRate >= current.successRate - MAX_SUCCESS_RATE_DROP_POINTS,
        )
        .sort((a, b) => a.avgCost - b.avgCost)[0];
      if (!alternative) continue;

      const savings = (current.avgCost - alternative.avgCost) * current.executions;
      suggestions.push({
        savings,
        text:
          `${roleLabel(segment.role)}・${complexityLabel(segment.complexityBand)}では、` +
          `${current.model}（${current.executions}件、成功率${Math.round(current.successRate)}%）から` +
          `${alternative.model}（${alternative.executions}件、成功率${Math.round(alternative.successRate)}%）への` +
          `選択を増やすと、同じ実行量あたり約$${savings.toFixed(2)}の削減が見込めます`,
      });
    }
  }

  return suggestions
    .sort((a, b) => b.savings - a.savings)
    .slice(0, 5)
    .map((item) => item.text);
}

function workflowRole(mode: string | null | undefined): string | null {
  if (!mode?.startsWith('workflow-')) return null;
  const role = mode.slice('workflow-'.length).trim();
  return role || null;
}

function toComplexityBand(score: number | null | undefined): ComplexityBand | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score <= 35) return 'low';
  if (score <= 70) return 'medium';
  return 'high';
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    researcher: '調査',
    planner: '計画',
    implementer: '実装',
    verifier: '検証',
    auto_verifier: '自動検証',
  };
  return labels[role] ?? role;
}

function complexityLabel(band: ComplexityBand): string {
  return { low: '低難度', medium: '中難度', high: '高難度' }[band];
}
