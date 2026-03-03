/**
 * タスク複雑度分析サービス
 *
 * タスクのタイトル・説明・推定時間から複雑度を自動判定し、
 * 適切なワークフローモードを推奨するシステム
 */

export interface TaskComplexityInput {
  title: string;
  description?: string | null;
  estimatedHours?: number | null;
  labels?: string[]; // ラベル配列
  priority?: string; // low, medium, high, urgent
  themeId?: number | null;
}

export interface ComplexityAnalysisResult {
  complexityScore: number; // 0-100のスコア
  recommendedMode: 'lightweight' | 'standard' | 'comprehensive';
  confidence: number; // 判定の信頼度 0-1
  analysisBreakdown: {
    keywordScore: number;
    timeScore: number;
    priorityScore: number;
    labelScore: number;
    reasons: string[];
  };
  estimatedExecutionTime: number; // 推定実行時間（分）
}

/**
 * 軽量タスクを示すキーワードパターン
 * バグ修正、UI調整、軽微な変更など
 */
const LIGHTWEIGHT_KEYWORDS = [
  // バグ修正関連
  'バグ', 'bug', 'fix', '修正', '直す', 'エラー', 'error', '不具合',
  // UI調整関連
  'UI', 'スタイル', 'style', 'CSS', 'デザイン', 'レイアウト', 'layout',
  '色', 'カラー', 'color', 'フォント', 'font', 'サイズ', 'size', 'マージン', 'margin', 'パディング', 'padding',
  // 軽微な変更
  'タイポ', 'typo', '誤字', '文言', 'テキスト', 'text', 'ラベル', 'label',
  'コメント', 'comment', 'ログ', 'log', '追加', 'add', '更新', 'update',
  // 小規模修正
  '小さな', '小規模', 'small', 'minor', '簡単', 'simple', '軽微', 'tiny', 'quick',
  // 設定関連
  '設定', 'config', 'configuration', '調整', 'adjust', '変更', 'change'
];

/**
 * 重量タスクを示すキーワードパターン
 * 新機能、アーキテクチャ変更、大規模リファクタリングなど
 */
const HEAVYWEIGHT_KEYWORDS = [
  // 新機能関連
  '新機能', '機能', 'feature', '実装', 'implement', '開発', 'develop', '構築', 'build',
  // アーキテクチャ関連
  'リファクタリング', 'refactor', 'アーキテクチャ', 'architecture', '再設計', 'redesign',
  '最適化', 'optimize', 'パフォーマンス', 'performance',
  // インフラ・API関連
  'API', 'エンドポイント', 'endpoint', 'データベース', 'database', 'DB', 'スキーマ', 'schema',
  'マイグレーション', 'migration', 'テーブル', 'table', 'インデックス', 'index',
  // システム関連
  'システム', 'system', 'フレームワーク', 'framework', 'ライブラリ', 'library',
  'セキュリティ', 'security', '認証', 'auth', 'authentication', '認可', 'authorization',
  // 統合・連携
  '統合', 'integration', '連携', 'サードパーティ', 'third-party', '外部', 'external',
  // 大規模変更
  '大幅', '大規模', 'major', 'large', '全体的', 'overall', '包括的', 'comprehensive'
];

/**
 * 軽量タスクを示すラベルキーワード
 */
const LIGHTWEIGHT_LABEL_KEYWORDS = [
  'bug', 'fix', 'hotfix', 'patch', 'style', 'ui', 'design', 'typo', 'docs', 'comment'
];

/**
 * 重量タスクを示すラベルキーワード
 */
const HEAVYWEIGHT_LABEL_KEYWORDS = [
  'feature', 'enhancement', 'refactor', 'api', 'database', 'schema', 'migration',
  'architecture', 'security', 'performance', 'integration', 'system'
];

/**
 * キーワードベース分析
 */
function analyzeKeywords(input: TaskComplexityInput): { score: number; reasons: string[] } {
  const text = `${input.title} ${input.description || ''}`.toLowerCase();
  const reasons: string[] = [];

  let lightweightMatches = 0;
  let heavyweightMatches = 0;

  // 軽量キーワードの検出
  for (const keyword of LIGHTWEIGHT_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) {
      lightweightMatches++;
      reasons.push(`軽量キーワード検出: "${keyword}"`);
    }
  }

  // 重量キーワードの検出
  for (const keyword of HEAVYWEIGHT_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) {
      heavyweightMatches++;
      reasons.push(`重量キーワード検出: "${keyword}"`);
    }
  }

  // スコア算出（0-100）
  // 軽量キーワードが多いほどスコアが下がる、重量キーワードが多いほどスコアが上がる
  const keywordBalance = heavyweightMatches - lightweightMatches;
  const baseScore = 50; // デフォルト値
  let score = baseScore + (keywordBalance * 15); // キーワード1つにつき15点の差

  // 極端な値の制限
  score = Math.max(0, Math.min(100, score));

  if (lightweightMatches > heavyweightMatches) {
    reasons.push(`軽量傾向 (軽量:${lightweightMatches}, 重量:${heavyweightMatches})`);
  } else if (heavyweightMatches > lightweightMatches) {
    reasons.push(`重量傾向 (軽量:${lightweightMatches}, 重量:${heavyweightMatches})`);
  } else {
    reasons.push(`キーワード分析: バランス型`);
  }

  return { score, reasons };
}

/**
 * 推定時間による分析
 */
function analyzeEstimatedTime(input: TaskComplexityInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  if (!input.estimatedHours) {
    reasons.push('推定時間未設定 (標準値を使用)');
    return { score: 50, reasons }; // デフォルト値
  }

  let score: number;

  if (input.estimatedHours <= 1) {
    score = 20;
    reasons.push(`推定時間: ${input.estimatedHours}時間 (軽量)`);
  } else if (input.estimatedHours <= 2) {
    score = 35;
    reasons.push(`推定時間: ${input.estimatedHours}時間 (軽量-標準)`);
  } else if (input.estimatedHours <= 4) {
    score = 60;
    reasons.push(`推定時間: ${input.estimatedHours}時間 (標準)`);
  } else if (input.estimatedHours <= 8) {
    score = 80;
    reasons.push(`推定時間: ${input.estimatedHours}時間 (重量)`);
  } else {
    score = 95;
    reasons.push(`推定時間: ${input.estimatedHours}時間 (超重量)`);
  }

  return { score, reasons };
}

/**
 * 優先度による分析
 */
function analyzePriority(input: TaskComplexityInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  if (!input.priority) {
    reasons.push('優先度未設定 (標準値を使用)');
    return { score: 50, reasons };
  }

  let score: number;

  switch (input.priority) {
    case 'low':
      score = 30;
      reasons.push('低優先度 → 軽量傾向');
      break;
    case 'medium':
      score = 50;
      reasons.push('中優先度 → 標準');
      break;
    case 'high':
      score = 70;
      reasons.push('高優先度 → 重量傾向');
      break;
    case 'urgent':
      score = 40; // 緊急は短時間で修正すべき問題が多い
      reasons.push('緊急 → 軽量-標準 (迅速対応が必要)');
      break;
    default:
      score = 50;
      reasons.push(`不明な優先度: ${input.priority}`);
  }

  return { score, reasons };
}

/**
 * ラベルによる分析
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

    // 軽量ラベルの検出
    for (const keyword of LIGHTWEIGHT_LABEL_KEYWORDS) {
      if (labelLower.includes(keyword)) {
        lightweightLabelMatches++;
        reasons.push(`軽量ラベル: "${label}"`);
        break;
      }
    }

    // 重量ラベルの検出
    for (const keyword of HEAVYWEIGHT_LABEL_KEYWORDS) {
      if (labelLower.includes(keyword)) {
        heavyweightLabelMatches++;
        reasons.push(`重量ラベル: "${label}"`);
        break;
      }
    }
  }

  // スコア算出
  const labelBalance = heavyweightLabelMatches - lightweightLabelMatches;
  let score = 50 + (labelBalance * 20); // ラベル1つにつき20点の差
  score = Math.max(0, Math.min(100, score));

  return { score, reasons };
}

/**
 * 複雑度スコアから推奨モードを決定
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
 * 推定実行時間を計算（分）
 */
function calculateEstimatedExecutionTime(mode: 'lightweight' | 'standard' | 'comprehensive'): number {
  switch (mode) {
    case 'lightweight':
      return 20; // 15-30分
    case 'standard':
      return 90; // 1-2時間
    case 'comprehensive':
      return 210; // 3-4時間
    default:
      return 90;
  }
}

/**
 * 判定の信頼度を計算
 */
function calculateConfidence(
  keywordScore: number,
  timeScore: number,
  priorityScore: number,
  labelScore: number,
  hasEstimatedTime: boolean
): number {
  // 各分析要素の信頼度重みづけ
  let confidence = 0.5; // ベース値

  // 推定時間がある場合は信頼度UP
  if (hasEstimatedTime) {
    confidence += 0.2;
  }

  // キーワード分析の一致度
  const keywordDeviation = Math.abs(keywordScore - 50);
  confidence += Math.min(0.3, keywordDeviation / 100);

  // 各分析結果の整合性
  const scores = [keywordScore, timeScore, priorityScore, labelScore];
  const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance = scores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / scores.length;
  const consistency = Math.max(0, 1 - variance / 1000); // 分散が小さいほど一貫性高い

  confidence += consistency * 0.2;

  return Math.min(1.0, confidence);
}

/**
 * メイン分析関数
 */
export function analyzeTaskComplexity(input: TaskComplexityInput): ComplexityAnalysisResult {
  // 各分析要素を実行
  const keywordAnalysis = analyzeKeywords(input);
  const timeAnalysis = analyzeEstimatedTime(input);
  const priorityAnalysis = analyzePriority(input);
  const labelAnalysis = analyzeLabels(input);

  // 重みづけによる最終スコア算出
  const weights = {
    keyword: 0.4,  // キーワード分析が最重要
    time: 0.3,     // 推定時間も重要
    priority: 0.15, // 優先度は補助的
    label: 0.15    // ラベルも補助的
  };

  const complexityScore = Math.round(
    keywordAnalysis.score * weights.keyword +
    timeAnalysis.score * weights.time +
    priorityAnalysis.score * weights.priority +
    labelAnalysis.score * weights.label
  );

  const recommendedMode = getRecommendedMode(complexityScore);
  const estimatedExecutionTime = calculateEstimatedExecutionTime(recommendedMode);

  const confidence = calculateConfidence(
    keywordAnalysis.score,
    timeAnalysis.score,
    priorityAnalysis.score,
    labelAnalysis.score,
    !!input.estimatedHours
  );

  // すべての理由をまとめる
  const allReasons = [
    ...keywordAnalysis.reasons,
    ...timeAnalysis.reasons,
    ...priorityAnalysis.reasons,
    ...labelAnalysis.reasons
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
      reasons: allReasons
    },
    estimatedExecutionTime
  };
}

/**
 * 複数タスクの一括分析
 */
export function analyzeBatchComplexity(inputs: TaskComplexityInput[]): ComplexityAnalysisResult[] {
  return inputs.map(input => analyzeTaskComplexity(input));
}

/**
 * ワークフローモード設定の取得（将来的にDBから取得予定）
 */
export function getWorkflowModeConfig() {
  return {
    lightweight: {
      name: '軽量',
      description: 'バグ修正・UI調整・軽微な変更に適用',
      estimatedTime: 20,
      complexityRange: [0, 35]
    },
    standard: {
      name: '標準',
      description: '中規模機能追加・リファクタリングに適用',
      estimatedTime: 90,
      complexityRange: [36, 70]
    },
    comprehensive: {
      name: '詳細',
      description: '大規模機能・アーキテクチャ変更に適用',
      estimatedTime: 210,
      complexityRange: [71, 100]
    }
  };
}