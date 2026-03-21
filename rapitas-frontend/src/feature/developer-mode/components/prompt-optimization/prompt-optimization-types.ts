/**
 * promptOptimizationTypes
 *
 * Shared type definitions for the PromptOptimizationPanel feature.
 * Contains no runtime logic or React imports.
 */

export type PromptClarificationQuestion = {
  id: string;
  question: string;
  options?: string[];
  isRequired: boolean;
  category:
    | 'scope'
    | 'technical'
    | 'requirements'
    | 'constraints'
    | 'integration'
    | 'testing'
    | 'deliverables';
};

export type StructuredSections = {
  objective: string;
  context: string;
  requirements: string[];
  constraints: string[];
  deliverables: string[];
  technicalDetails?: string;
};

export type ScoreBreakdownItem = {
  score: number;
  reason: string;
  missing?: string[];
};

export type ScoreBreakdown = {
  clarity: ScoreBreakdownItem;
  completeness: ScoreBreakdownItem;
  technicalSpecificity: ScoreBreakdownItem;
  executability: ScoreBreakdownItem;
  context: ScoreBreakdownItem;
};

export type PromptQuality = {
  score: number;
  breakdown?: ScoreBreakdown;
  issues: string[];
  suggestions: string[];
};

export type OptimizedPromptResult = {
  optimizedPrompt: string;
  structuredSections: StructuredSections;
  clarificationQuestions: PromptClarificationQuestion[];
  promptQuality: PromptQuality;
  hasQuestions: boolean;
  tokensUsed: number;
};

// ─── Category helpers ────────────────────────────────────────────────────────

/**
 * Returns the Japanese display label for a question category.
 *
 * @param category - Category key / カテゴリキー
 * @returns Japanese label string
 */
export const getCategoryLabel = (category: string): string => {
  const labels: Record<string, string> = {
    scope: 'スコープ',
    technical: '技術的',
    requirements: '要件',
    constraints: '制約',
    integration: '統合',
    testing: 'テスト',
    deliverables: '成果物',
  };
  return labels[category] || category;
};

/**
 * Returns the Tailwind color classes for a question category badge.
 *
 * @param category - Category key / カテゴリキー
 * @returns Tailwind class string
 */
export const getCategoryColor = (category: string): string => {
  const colors: Record<string, string> = {
    scope: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    technical:
      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    requirements:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    constraints:
      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    integration:
      'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
    testing:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    deliverables:
      'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  };
  return (
    colors[category] ||
    'bg-zinc-100 text-zinc-700 dark:bg-indigo-dark-800 dark:text-zinc-400'
  );
};

/**
 * Returns the Tailwind text color class based on a quality score.
 *
 * @param score - Numeric quality score (0-100) / 品質スコア
 * @returns Tailwind text color class string
 */
export const getQualityColor = (score: number): string => {
  if (score >= 80) return 'text-green-600 dark:text-green-400';
  if (score >= 60) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
};
