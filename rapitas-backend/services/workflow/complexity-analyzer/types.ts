/**
 * Complexity Analyzer Types
 *
 * Shared interfaces, keyword constants, and label constants used across
 * the complexity analysis pipeline. Does not contain analysis logic.
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

export interface LearningInsight {
  sampleSize: number;
  recommendedMode: string;
  confidence: number;
  avgActualDuration: number;
  modeDistribution: Record<string, number>;
  differs: boolean;
}

/**
 * Keyword patterns indicating lightweight tasks (bug fixes, UI adjustments, minor changes).
 */
export const LIGHTWEIGHT_KEYWORDS = [
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
] as const;

/**
 * Keyword patterns indicating heavyweight tasks (new features, architecture changes, large refactoring).
 */
export const HEAVYWEIGHT_KEYWORDS = [
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
] as const;

/**
 * Label keywords indicating lightweight tasks.
 */
export const LIGHTWEIGHT_LABEL_KEYWORDS = [
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
] as const;

/**
 * Label keywords indicating heavyweight tasks.
 */
export const HEAVYWEIGHT_LABEL_KEYWORDS = [
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
] as const;
