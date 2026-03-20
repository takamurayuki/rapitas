/**
 * Complexity Analyzers
 *
 * Individual scoring functions (keyword, time, priority, label) and the shared
 * helper functions (getRecommendedMode, calculateEstimatedExecutionTime,
 * calculateConfidence) used by the aggregation layer in core.ts.
 * Does not handle learning-data lookups; see learning.ts for that.
 */

import type { TaskComplexityInput } from './types';
import {
  LIGHTWEIGHT_KEYWORDS,
  HEAVYWEIGHT_KEYWORDS,
  LIGHTWEIGHT_LABEL_KEYWORDS,
  HEAVYWEIGHT_LABEL_KEYWORDS,
} from './types';

/**
 * Keyword-based analysis.
 *
 * @param input - Task complexity input data / タスク複雑度の入力データ
 * @returns Score 0-100 and reasoning strings / スコアと理由の文字列
 */
export function analyzeKeywords(input: TaskComplexityInput): { score: number; reasons: string[] } {
  const text = `${input.title} ${input.description || ''}`.toLowerCase();
  const reasons: string[] = [];

  let lightweightMatches = 0;
  let heavyweightMatches = 0;

  // Detect lightweight keywords
  for (const keyword of LIGHTWEIGHT_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) {
      lightweightMatches++;
      reasons.push(`Lightweight keyword detected: "${keyword}"`);
    }
  }

  // Detect heavyweight keywords
  for (const keyword of HEAVYWEIGHT_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) {
      heavyweightMatches++;
      reasons.push(`Heavyweight keyword detected: "${keyword}"`);
    }
  }

  // Score calculation (0-100)
  // More lightweight keywords = lower score; more heavyweight keywords = higher score
  const keywordBalance = heavyweightMatches - lightweightMatches;
  const baseScore = 50; // Default
  let score = baseScore + keywordBalance * 15; // 15-point difference per keyword

  // Clamp to valid range
  score = Math.max(0, Math.min(100, score));

  if (lightweightMatches > heavyweightMatches) {
    reasons.push(`Lightweight tendency (lightweight:${lightweightMatches}, heavyweight:${heavyweightMatches})`);
  } else if (heavyweightMatches > lightweightMatches) {
    reasons.push(`Heavyweight tendency (lightweight:${lightweightMatches}, heavyweight:${heavyweightMatches})`);
  } else {
    reasons.push(`キーワード分析: バランス型`);
  }

  return { score, reasons };
}

/**
 * Estimated time analysis.
 *
 * @param input - Task complexity input data / タスク複雑度の入力データ
 * @returns Score 0-100 and reasoning strings / スコアと理由の文字列
 */
export function analyzeEstimatedTime(input: TaskComplexityInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  if (!input.estimatedHours) {
    reasons.push('Estimated time not set (using default value)');
    return { score: 50, reasons }; // Default value
  }

  let score: number;

  if (input.estimatedHours <= 1) {
    score = 20;
    reasons.push(`Estimated time: ${input.estimatedHours} hours (lightweight)`);
  } else if (input.estimatedHours <= 2) {
    score = 35;
    reasons.push(`Estimated time: ${input.estimatedHours} hours (lightweight-standard)`);
  } else if (input.estimatedHours <= 4) {
    score = 60;
    reasons.push(`推定時間: ${input.estimatedHours}hours (standard)`);
  } else if (input.estimatedHours <= 8) {
    score = 80;
    reasons.push(`推定時間: ${input.estimatedHours}hours (heavyweight)`);
  } else {
    score = 95;
    reasons.push(`推定時間: ${input.estimatedHours}hours (ultra-heavyweight)`);
  }

  return { score, reasons };
}

/**
 * Priority-based analysis.
 *
 * @param input - Task complexity input data / タスク複雑度の入力データ
 * @returns Score 0-100 and reasoning strings / スコアと理由の文字列
 */
export function analyzePriority(input: TaskComplexityInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  if (!input.priority) {
    reasons.push('Priority not set (using default value)');
    return { score: 50, reasons };
  }

  let score: number;

  switch (input.priority) {
    case 'low':
      score = 30;
      reasons.push('Low priority → lightweight tendency');
      break;
    case 'medium':
      score = 50;
      reasons.push('Medium priority → standard');
      break;
    case 'high':
      score = 70;
      reasons.push('High priority → heavyweight tendency');
      break;
    case 'urgent':
      score = 40; // Urgent issues often need quick fixes
      reasons.push('Urgent → lightweight-standard (requires quick response)');
      break;
    default:
      score = 50;
      reasons.push(`Unknown priority: ${input.priority}`);
  }

  return { score, reasons };
}

/**
 * Label-based analysis.
 *
 * @param input - Task complexity input data / タスク複雑度の入力データ
 * @returns Score 0-100 and reasoning strings / スコアと理由の文字列
 */
export function analyzeLabels(input: TaskComplexityInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  if (!input.labels || input.labels.length === 0) {
    reasons.push('ラベル未設定');
    return { score: 50, reasons };
  }

  let lightweightLabelMatches = 0;
  let heavyweightLabelMatches = 0;

  for (const label of input.labels) {
    const labelLower = label.toLowerCase();

    // Detect lightweight labels
    for (const keyword of LIGHTWEIGHT_LABEL_KEYWORDS) {
      if (labelLower.includes(keyword)) {
        lightweightLabelMatches++;
        reasons.push(`軽量ラベル: "${label}"`);
        break;
      }
    }

    // Detect heavyweight labels
    for (const keyword of HEAVYWEIGHT_LABEL_KEYWORDS) {
      if (labelLower.includes(keyword)) {
        heavyweightLabelMatches++;
        reasons.push(`重量ラベル: "${label}"`);
        break;
      }
    }
  }

  // Score calculation
  const labelBalance = heavyweightLabelMatches - lightweightLabelMatches;
  let score = 50 + labelBalance * 20; // 20-point difference per label
  score = Math.max(0, Math.min(100, score));

  return { score, reasons };
}

/**
 * Determine recommended mode from complexity score.
 *
 * @param complexityScore - Aggregated complexity score 0-100 / 集計された複雑度スコア
 * @returns Workflow mode recommendation / ワークフローモードの推奨
 */
export function getRecommendedMode(complexityScore: number): 'lightweight' | 'standard' | 'comprehensive' {
  if (complexityScore <= 35) {
    return 'lightweight';
  } else if (complexityScore <= 70) {
    return 'standard';
  } else {
    return 'comprehensive';
  }
}

/**
 * Calculate estimated execution time in minutes.
 *
 * @param mode - Workflow mode / ワークフローモード
 * @returns Estimated minutes / 推定分数
 */
export function calculateEstimatedExecutionTime(
  mode: 'lightweight' | 'standard' | 'comprehensive',
): number {
  switch (mode) {
    case 'lightweight':
      return 20; // 15-30 minutes
    case 'standard':
      return 90; // 1-2 hours
    case 'comprehensive':
      return 210; // 3-4 hours
    default:
      return 90;
  }
}

/**
 * Calculate judgment confidence.
 *
 * @param keywordScore - Score from keyword analysis / キーワード分析スコア
 * @param timeScore - Score from time analysis / 時間分析スコア
 * @param priorityScore - Score from priority analysis / 優先度分析スコア
 * @param labelScore - Score from label analysis / ラベル分析スコア
 * @param hasEstimatedTime - Whether estimated time was provided / 推定時間が設定されているか
 * @returns Confidence value 0-1 / 確信度 0-1
 */
export function calculateConfidence(
  keywordScore: number,
  timeScore: number,
  priorityScore: number,
  labelScore: number,
  hasEstimatedTime: boolean,
): number {
  // Weighted confidence from each analysis factor
  let confidence = 0.5; // Base value

  // Estimated time available = higher confidence
  if (hasEstimatedTime) {
    confidence += 0.2;
  }

  // Keyword analysis match degree
  const keywordDeviation = Math.abs(keywordScore - 50);
  confidence += Math.min(0.3, keywordDeviation / 100);

  // Consistency across analysis results
  const scores = [keywordScore, timeScore, priorityScore, labelScore];
  const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance =
    scores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / scores.length;
  const consistency = Math.max(0, 1 - variance / 1000); // Lower variance = higher consistency

  confidence += consistency * 0.2;

  return Math.min(1.0, confidence);
}
