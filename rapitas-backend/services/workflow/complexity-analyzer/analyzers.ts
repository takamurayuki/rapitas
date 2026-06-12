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
 * Tests whether a keyword occurs in text. ASCII keywords are matched on word
 * boundaries so short tokens don't produce substring false positives (e.g. "ui"
 * inside "build", "log" inside "login", "api" inside "capital"). CJK keywords
 * have no word boundaries, so substring containment is used for them.
 *
 * @param text - Lowercased haystack / 小文字化済みの検索対象
 * @param keyword - Keyword to look for / 検索キーワード
 * @returns True if the keyword is present / キーワードが含まれていれば true
 */
function keywordMatches(text: string, keyword: string): boolean {
  const k = keyword.toLowerCase();
  // Printable-ASCII-only keyword → boundary match.
  if (/^[\x20-\x7e]+$/.test(k)) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(text);
  }
  return text.includes(k);
}

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
    if (keywordMatches(text, keyword)) {
      lightweightMatches++;
      reasons.push(`Lightweight keyword detected: "${keyword}"`);
    }
  }

  // Detect heavyweight keywords
  for (const keyword of HEAVYWEIGHT_KEYWORDS) {
    if (keywordMatches(text, keyword)) {
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
    reasons.push(
      `Lightweight tendency (lightweight:${lightweightMatches}, heavyweight:${heavyweightMatches})`,
    );
  } else if (heavyweightMatches > lightweightMatches) {
    reasons.push(
      `Heavyweight tendency (lightweight:${lightweightMatches}, heavyweight:${heavyweightMatches})`,
    );
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
export function analyzeEstimatedTime(input: TaskComplexityInput): {
  score: number;
  reasons: string[];
} {
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
 * Scope / structure analysis.
 *
 * Uses concrete difficulty signals that scale with task size: the length of the
 * description and the number of structured-spec items (goals + constraints +
 * acceptance criteria). More detail and more criteria ⇒ a harder task. Returns a
 * neutral 50 when neither signal is present.
 *
 * @param input - Task complexity input data / タスク複雑度の入力データ
 * @returns Score 0-100 and reasoning strings / スコアと理由の文字列
 */
export function analyzeScope(input: TaskComplexityInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const descLength = (input.description ?? '').trim().length;
  const specCount =
    (input.goals?.length ?? 0) +
    (input.constraints?.length ?? 0) +
    (input.acceptanceCriteria?.length ?? 0);

  if (descLength === 0 && specCount === 0) {
    reasons.push('スコープ情報なし（説明・スペック未設定 → デフォルト値）');
    return { score: 50, reasons };
  }

  // Description length → difficulty band.
  let descScore: number | null = null;
  if (descLength > 0) {
    if (descLength < 80) descScore = 30;
    else if (descLength < 250) descScore = 50;
    else if (descLength < 600) descScore = 70;
    else descScore = 85;
    reasons.push(`説明文 ${descLength} 文字 (scope score ${descScore})`);
  }

  // Structured-spec count → difficulty band. Explicit criteria are a stronger
  // signal than prose, so this is weighted higher when both are present.
  let specScore: number | null = null;
  if (specCount > 0) {
    if (specCount <= 2) specScore = 45;
    else if (specCount <= 5) specScore = 62;
    else if (specCount <= 9) specScore = 78;
    else specScore = 92;
    reasons.push(`スペック項目 ${specCount} 件 (scope score ${specScore})`);
  }

  let score: number;
  if (descScore !== null && specScore !== null) {
    score = Math.round(descScore * 0.45 + specScore * 0.55);
  } else {
    score = (descScore ?? specScore) as number;
  }

  return { score, reasons };
}

/**
 * Determine recommended mode from complexity score.
 *
 * @param complexityScore - Aggregated complexity score 0-100 / 集計された複雑度スコア
 * @returns Workflow mode recommendation / ワークフローモードの推奨
 */
export function getRecommendedMode(
  complexityScore: number,
): 'lightweight' | 'standard' | 'comprehensive' {
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
 * @param scopeScore - Score from scope analysis / スコープ分析スコア
 * @param hasEstimatedTime - Whether estimated time was provided / 推定時間が設定されているか
 * @returns Confidence value 0-1 / 確信度 0-1
 */
export function calculateConfidence(
  keywordScore: number,
  timeScore: number,
  priorityScore: number,
  labelScore: number,
  scopeScore: number,
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
  const scores = [keywordScore, timeScore, priorityScore, labelScore, scopeScore];
  const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance =
    scores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / scores.length;
  const consistency = Math.max(0, 1 - variance / 1000); // Lower variance = higher consistency

  confidence += consistency * 0.2;

  return Math.min(1.0, confidence);
}
