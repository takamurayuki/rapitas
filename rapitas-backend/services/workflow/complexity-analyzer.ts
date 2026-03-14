/**
 * Task Complexity Analysis Service
 *
 * Automatically determines task complexity from title, description, and estimated time,
 * and recommends the appropriate workflow mode.
 */

export interface TaskComplexityInput {
  title: string;
  description?: string | null;
  estimatedHours?: number | null;
  labels?: string[]; // Label array
  priority?: string; // low, medium, high, urgent
  themeId?: number | null;
}

export interface ComplexityAnalysisResult {
  complexityScore: number; // Score from 0-100
  recommendedMode: 'lightweight' | 'standard' | 'comprehensive';
  confidence: number; // Confidence level 0-1
  analysisBreakdown: {
    keywordScore: number;
    timeScore: number;
    priorityScore: number;
    labelScore: number;
    reasons: string[];
  };
  estimatedExecutionTime: number; // Estimated execution time (minutes)
}

/**
 * Keyword patterns indicating lightweight tasks (bug fixes, UI adjustments, minor changes).
 */
const LIGHTWEIGHT_KEYWORDS = [
  // Bug fix related
  'バグ',
  'bug',
  'fix',
  '修正',
  '直す',
  'エラー',
  'error',
  '不具合',
  // UI adjustment related
  'UI',
  'スタイル',
  'style',
  'CSS',
  'デザイン',
  'レイアウト',
  'layout',
  '色',
  'カラー',
  'color',
  'フォント',
  'font',
  'サイズ',
  'size',
  'マージン',
  'margin',
  'パディング',
  'padding',
  // Minor changes
  'タイポ',
  'typo',
  '誤字',
  '文言',
  'テキスト',
  'text',
  'ラベル',
  'label',
  'コメント',
  'comment',
  'ログ',
  'log',
  '追加',
  'add',
  '更新',
  'update',
  // Small fixes
  '小さな',
  '小規模',
  'small',
  'minor',
  '簡単',
  'simple',
  '軽微',
  'tiny',
  'quick',
  // Configuration related
  '設定',
  'config',
  'configuration',
  '調整',
  'adjust',
  '変更',
  'change',
];

/**
 * Keyword patterns indicating heavyweight tasks (new features, architecture changes, large refactoring).
 */
const HEAVYWEIGHT_KEYWORDS = [
  // New feature related
  '新機能',
  '機能',
  'feature',
  '実装',
  'implement',
  '開発',
  'develop',
  '構築',
  'build',
  // Architecture related
  'リファクタリング',
  'refactor',
  'アーキテクチャ',
  'architecture',
  '再設計',
  'redesign',
  '最適化',
  'optimize',
  'パフォーマンス',
  'performance',
  // Infrastructure / API related
  'API',
  'エンドポイント',
  'endpoint',
  'データベース',
  'database',
  'DB',
  'スキーマ',
  'schema',
  'マイグレーション',
  'migration',
  'テーブル',
  'table',
  'インデックス',
  'index',
  // System related
  'システム',
  'system',
  'フレームワーク',
  'framework',
  'ライブラリ',
  'library',
  'セキュリティ',
  'security',
  '認証',
  'auth',
  'authentication',
  '認可',
  'authorization',
  // Integration
  '統合',
  'integration',
  '連携',
  'サードパーティ',
  'third-party',
  '外部',
  'external',
  // Large-scale changes
  '大幅',
  '大規模',
  'major',
  'large',
  '全体的',
  'overall',
  '包括的',
  'comprehensive',
];

/**
 * Label keywords indicating lightweight tasks.
 */
const LIGHTWEIGHT_LABEL_KEYWORDS = [
  'bug',
  'fix',
  'hotfix',
  'patch',
  'style',
  'ui',
  'design',
  'typo',
  'docs',
  'comment',
];

/**
 * Label keywords indicating heavyweight tasks.
 */
const HEAVYWEIGHT_LABEL_KEYWORDS = [
  'feature',
  'enhancement',
  'refactor',
  'api',
  'database',
  'schema',
  'migration',
  'architecture',
  'security',
  'performance',
  'integration',
  'system',
];

/**
 * Keyword-based analysis.
 */
function analyzeKeywords(input: TaskComplexityInput): { score: number; reasons: string[] } {
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
 */
function analyzeEstimatedTime(input: TaskComplexityInput): { score: number; reasons: string[] } {
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
 */
function analyzePriority(input: TaskComplexityInput): { score: number; reasons: string[] } {
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
 */
function analyzeLabels(input: TaskComplexityInput): { score: number; reasons: string[] } {
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
 */
function getRecommendedMode(complexityScore: number): 'lightweight' | 'standard' | 'comprehensive' {
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
 */
function calculateEstimatedExecutionTime(
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
 */
function calculateConfidence(
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

/**
 * Main analysis function.
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
 */
export function analyzeBatchComplexity(inputs: TaskComplexityInput[]): ComplexityAnalysisResult[] {
  return inputs.map((input) => analyzeTaskComplexity(input));
}

/**
 * Get workflow mode configuration (to be fetched from DB in the future).
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

/**
 * Complexity analysis with learning data (extended version).
 *
 * In addition to standard analyzeTaskComplexity, reflects historical learning records
 * from similar tasks to return an optimized recommended mode.
 */
export async function analyzeTaskComplexityWithLearning(
  input: TaskComplexityInput,
): Promise<ComplexityAnalysisResult & { learningInsight?: LearningInsight }> {
  const baseResult = analyzeTaskComplexity(input);

  try {
    // Dynamic import to avoid circular dependency with Prisma
    const { prisma } = await import('../../config');

    // Fetch learning records for the same theme
    const where: Record<string, unknown> = { success: true };
    if (input.themeId) where.themeId = input.themeId;

    const records = await prisma.workflowLearningRecord.findMany({
      where,
      select: {
        workflowMode: true,
        predictedComplexity: true,
        actualDurationMinutes: true,
        estimatedDuration: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    if (records.length < 3) {
      return baseResult;
    }

    // Extract tasks with similar complexity (within +/-15 points)
    const similar = records.filter(
      (r) =>
        r.predictedComplexity !== null &&
        Math.abs(r.predictedComplexity - baseResult.complexityScore) < 15,
    );

    if (similar.length < 3) {
      return baseResult;
    }

    // Determine the mode with highest success rate
    const modeCount: Record<string, number> = {};
    for (const r of similar) {
      modeCount[r.workflowMode] = (modeCount[r.workflowMode] || 0) + 1;
    }

    const sortedModes = Object.entries(modeCount).sort((a, b) => b[1] - a[1]);
    const topMode = sortedModes[0];

    // If sufficient data recommends a different mode than base analysis
    const learningRecommendedMode = topMode[0] as 'lightweight' | 'standard' | 'comprehensive';
    const learningConfidence = topMode[1] / similar.length;

    // Estimated time based on historical data
    const durations = similar
      .map((r) => r.actualDurationMinutes)
      .filter((d): d is number => d !== null);
    const avgActualDuration =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : baseResult.estimatedExecutionTime;

    const insight: LearningInsight = {
      sampleSize: similar.length,
      recommendedMode: learningRecommendedMode,
      confidence: Math.round(learningConfidence * 100) / 100,
      avgActualDuration,
      modeDistribution: modeCount,
      differs: learningRecommendedMode !== baseResult.recommendedMode,
    };

    // Override mode if learning data confidence is high
    if (insight.differs && learningConfidence >= 0.7 && similar.length >= 5) {
      return {
        ...baseResult,
        recommendedMode: learningRecommendedMode,
        estimatedExecutionTime: avgActualDuration,
        analysisBreakdown: {
          ...baseResult.analysisBreakdown,
          reasons: [
            ...baseResult.analysisBreakdown.reasons,
            `学習データ: 類似${similar.length}件中${topMode[1]}件が${learningRecommendedMode}で成功`,
          ],
        },
        learningInsight: insight,
      };
    }

    return { ...baseResult, learningInsight: insight };
  } catch {
    // On DB connection failure, return base result as-is
    return baseResult;
  }
}

export interface LearningInsight {
  sampleSize: number;
  recommendedMode: string;
  confidence: number;
  avgActualDuration: number;
  modeDistribution: Record<string, number>;
  differs: boolean;
}
