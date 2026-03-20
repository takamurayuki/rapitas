/**
 * Complexity Analyzer — Core Aggregation
 *
 * Provides the main analyzeTaskComplexity entry point, batch processing,
 * and the workflow mode configuration table. Depends on analyzers.ts for
 * individual factor scores and types.ts for interfaces.
 */

import type { TaskComplexityInput, ComplexityAnalysisResult } from './types';
import {
  analyzeKeywords,
  analyzeEstimatedTime,
  analyzePriority,
  analyzeLabels,
  getRecommendedMode,
  calculateEstimatedExecutionTime,
  calculateConfidence,
} from './analyzers';

/**
 * Main analysis function. Runs all four analyzers and aggregates into a single result.
 *
 * @param input - Task complexity input data / タスク複雑度の入力データ
 * @returns Full complexity analysis result / 複雑度分析結果
 */
export function analyzeTaskComplexity(input: TaskComplexityInput): ComplexityAnalysisResult {
  // Run each analysis factor
  const keywordAnalysis = analyzeKeywords(input);
  const timeAnalysis = analyzeEstimatedTime(input);
  const priorityAnalysis = analyzePriority(input);
  const labelAnalysis = analyzeLabels(input);

  // Final score via weighted average
  const weights = {
    keyword: 0.4, // Keyword analysis is most important
    time: 0.3, // Estimated time is also important
    priority: 0.15, // Priority is supplementary
    label: 0.15, // Labels are supplementary
  };

  const complexityScore = Math.round(
    keywordAnalysis.score * weights.keyword +
      timeAnalysis.score * weights.time +
      priorityAnalysis.score * weights.priority +
      labelAnalysis.score * weights.label,
  );

  const recommendedMode = getRecommendedMode(complexityScore);
  const estimatedExecutionTime = calculateEstimatedExecutionTime(recommendedMode);

  const confidence = calculateConfidence(
    keywordAnalysis.score,
    timeAnalysis.score,
    priorityAnalysis.score,
    labelAnalysis.score,
    !!input.estimatedHours,
  );

  // Aggregate all reasons
  const allReasons = [
    ...keywordAnalysis.reasons,
    ...timeAnalysis.reasons,
    ...priorityAnalysis.reasons,
    ...labelAnalysis.reasons,
  ];

  return {
    complexityScore,
    recommendedMode,
    confidence,
    analysisBreakdown: {
      keywordScore: Math.round(keywordAnalysis.score),
      timeScore: Math.round(timeAnalysis.score),
      priorityScore: Math.round(priorityAnalysis.score),
      labelScore: Math.round(labelAnalysis.score),
      reasons: allReasons,
    },
    estimatedExecutionTime,
  };
}

/**
 * Batch analysis for multiple tasks.
 *
 * @param inputs - Array of task complexity inputs / タスク複雑度入力の配列
 * @returns Array of analysis results / 分析結果の配列
 */
export function analyzeBatchComplexity(inputs: TaskComplexityInput[]): ComplexityAnalysisResult[] {
  return inputs.map((input) => analyzeTaskComplexity(input));
}

/**
 * Get workflow mode configuration (to be fetched from DB in the future).
 *
 * @returns Static configuration object for all three workflow modes / 3つのワークフローモードの設定
 */
export function getWorkflowModeConfig() {
  return {
    lightweight: {
      name: '軽量',
      description: 'バグ修正・UI調整・軽微な変更に適用',
      estimatedTime: 20,
      complexityRange: [0, 35],
    },
    standard: {
      name: '標準',
      description: '中規模機能追加・リファクタリングに適用',
      estimatedTime: 90,
      complexityRange: [36, 70],
    },
    comprehensive: {
      name: '詳細',
      description: '大規模機能・アーキテクチャ変更に適用',
      estimatedTime: 210,
      complexityRange: [71, 100],
    },
  };
}
