/**
 * Cost Optimization Suggestions
 *
 * Builds the human-readable cost-saving suggestion strings shown on the
 * cost-optimization panel, either from a segment-aware comparison (role +
 * complexity band) or a simple whole-fleet fallback comparison.
 */

import { toInt } from '../../metric-coercion';
import { resolveExecutionCost } from './cost-optimization-cost-resolver';
import type {
  ModelCostStats,
  ComplexityBand,
  ComparableExecution,
  SegmentModelStats,
} from './cost-optimization-types';

const MIN_COMPARABLE_EXECUTIONS = 5;
const MAX_SUCCESS_RATE_DROP_POINTS = 5;

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
export function buildSegmentSuggestions(executions: ComparableExecution[]): string[] {
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
