/**
 * simple-log-entry/log-entry-styles
 *
 * Category → colour mapping for the friendly log rows. These keep the log's
 * ORIGINAL palette (blue = execution lifecycle/progress, green = success,
 * amber = warning, red = error, zinc = mechanical info) — per user feedback,
 * established entry colours are not repainted.
 *
 * NOTE: the log panel renders on a fixed dark surface (bg-zinc-900) in both
 * app themes, so these colours are absolute — no dark: variants needed.
 */

export interface LogCategoryStyle {
  row: string;
  icon: string;
  text: string;
}

const CATEGORY_STYLES: Record<string, LogCategoryStyle> = {
  success: { row: 'bg-green-950/20', icon: 'text-green-400', text: 'text-green-300' },
  error: { row: 'bg-red-950/20', icon: 'text-red-400', text: 'text-red-300' },
  warning: { row: 'bg-amber-950/20', icon: 'text-amber-400', text: 'text-amber-300' },
  progress: { row: '', icon: 'text-blue-400', text: 'text-blue-300' },
  info: { row: '', icon: 'text-zinc-400', text: 'text-zinc-300' },
  'agent-text': { row: '', icon: 'text-zinc-500', text: 'text-zinc-200' },
  'tool-result': { row: '', icon: 'text-zinc-600', text: 'text-zinc-500' },
  'phase-transition': { row: '', icon: 'text-blue-400', text: 'text-blue-300' },
};

/** Original per-phase chip colours for phase-transition dividers. */
export const PHASE_CHIP_COLORS: Record<string, string> = {
  research: 'border-blue-500/40 text-blue-300 bg-blue-500/10',
  plan: 'border-purple-500/40 text-purple-300 bg-purple-500/10',
  implement: 'border-amber-500/40 text-amber-300 bg-amber-500/10',
  verify: 'border-green-500/40 text-green-300 bg-green-500/10',
};

/**
 * Resolve a log category to its row/icon/text classes (falls back to info).
 *
 * @param category - Entry category. / エントリのカテゴリ
 * @returns Colour classes for the row. / 行のカラークラス
 */
export function getLogCategoryStyles(category: string): LogCategoryStyle {
  return CATEGORY_STYLES[category] || CATEGORY_STYLES.info;
}
