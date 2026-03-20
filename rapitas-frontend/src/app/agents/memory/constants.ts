/**
 * agents/memory/constants
 *
 * Static lookup tables and configuration objects shared across
 * the Agent Memory page and its sub-components.
 */

/** Colour palette for recharts pie chart slices, cycled by index. */
export const PIE_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
];

/** Human-readable Japanese labels for knowledge node types. */
export const NODE_TYPE_LABELS: Record<string, string> = {
  concept: 'コンセプト',
  problem: '問題',
  solution: '解決策',
  technology: 'テクノロジー',
  pattern: 'パターン',
};

/** Tailwind class sets keyed by memory strength level. */
export const LEVEL_CONFIG: Record<
  string,
  {
    color: string;
    bg: string;
    barColor: string;
    gradient: string;
  }
> = {
  expert: {
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    barColor: 'bg-purple-500',
    gradient: 'from-purple-500 to-indigo-500',
  },
  advanced: {
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    barColor: 'bg-blue-500',
    gradient: 'from-blue-500 to-cyan-500',
  },
  intermediate: {
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-100 dark:bg-green-900/30',
    barColor: 'bg-green-500',
    gradient: 'from-green-500 to-emerald-500',
  },
  beginner: {
    color: 'text-yellow-600 dark:text-yellow-400',
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    barColor: 'bg-yellow-500',
    gradient: 'from-yellow-500 to-orange-500',
  },
};

/** Japanese display labels for memory strength levels. */
export const LEVEL_LABELS: Record<string, string> = {
  expert: 'エキスパート',
  advanced: 'アドバンスド',
  intermediate: '中級',
  beginner: 'ビギナー',
};
