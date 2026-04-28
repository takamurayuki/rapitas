/**
 * SystemPrompts types
 *
 * Shared type definitions and constants for the system-prompts feature.
 */

export type SystemPrompt = {
  id: number;
  key: string;
  name: string;
  description: string | null;
  content: string;
  category: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export const CATEGORY_LABELS: Record<string, { labelKey: string; color: string }> = {
  general: {
    labelKey: 'categoryGeneral',
    color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300',
  },
  analysis: {
    labelKey: 'categoryAnalysis',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  },
  optimization: {
    labelKey: 'categoryOptimization',
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  },
  agent: {
    labelKey: 'categoryAgent',
    color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  },
  chat: {
    labelKey: 'categoryChat',
    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  },
};
