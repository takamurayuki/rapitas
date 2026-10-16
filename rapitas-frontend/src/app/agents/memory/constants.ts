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

/**
 * Known knowledge-node type keys, used to validate a category against
 * `agents.memory.nodeTypeLabels.*` before calling the translator — unknown
 * categories fall back to the raw value instead of a missing-message error.
 */
export const NODE_TYPE_KEYS = ['concept', 'problem', 'solution', 'technology', 'pattern'] as const;

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
    color: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-100 dark:bg-indigo-900/30',
    barColor: 'bg-indigo-500',
    gradient: 'from-indigo-500 to-cyan-500',
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

/**
 * Known memory-strength level keys, used to validate a level against
 * `agents.memory.levelLabels.*` before calling the translator — unknown
 * levels fall back to the raw value instead of a missing-message error.
 */
export const LEVEL_KEYS = ['expert', 'advanced', 'intermediate', 'beginner'] as const;
