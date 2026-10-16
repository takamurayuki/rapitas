/**
 * concern-search-score
 *
 * Derives the display-only fields (priority, impactScore, relatedTasks, pattern)
 * of a concern search hit. The stored concern has no numeric impact data, so the
 * score is a fixed, deterministic formula. NOT responsible for persistence.
 */

export type ConcernPriority = 'Critical' | 'High' | 'Medium' | 'Low';
type Severity = 'urgent' | 'high' | 'medium' | 'low';

// NOTE: Single source of truth for the impactScore formula; change constants here only.
const SEVERITY_BASE: Record<Severity, number> = { urgent: 8.5, high: 6.5, medium: 4.0, low: 2.0 };
const RELATED_TASK_WEIGHT = 0.3;
const RELATED_TASK_CAP = 5;
const MAX_SCORE = 10;

const PRIORITY: Record<Severity, ConcernPriority> = {
  urgent: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
const PATTERN: Record<ConcernPriority, string> = {
  Critical: '⬛⬛⬛',
  High: '⬛⬛⬜',
  Medium: '⬛⬜⬜',
  Low: '⬜⬜⬜',
};

export interface ConcernSearchItem {
  id: number;
  title: string;
  impactScore: number;
  relatedTasks: number;
  priority: ConcernPriority;
  pattern: string;
}

/**
 * Maps a stored severity to its display priority.
 *
 * @param severity - Concern severity / 懸念の重大度
 * @returns Display priority / 表示用の優先度
 */
export function toPriority(severity: Severity): ConcernPriority {
  return PRIORITY[severity];
}

/**
 * Counts the tasks linked to a concern (origin + created).
 *
 * @param concern - Concern task links / 懸念のタスク紐づけ
 * @returns Number of non-null task ids (0-2) / null でないタスクID数
 */
export function countRelatedTasks(concern: {
  originTaskId: number | null;
  createdTaskId: number | null;
}): number {
  return [concern.originTaskId, concern.createdTaskId].filter((v) => v != null).length;
}

/**
 * Computes the derived impact score (0-10, one decimal).
 *
 * @param severity - Concern severity / 重大度
 * @param relatedTasks - Related task count / 関連タスク数
 * @returns Impact score / 影響度スコア
 */
export function computeImpactScore(severity: Severity, relatedTasks: number): number {
  const raw =
    SEVERITY_BASE[severity] + Math.min(relatedTasks, RELATED_TASK_CAP) * RELATED_TASK_WEIGHT;
  return Math.round(Math.min(raw, MAX_SCORE) * 10) / 10;
}

/**
 * Renders the 3-cell severity pattern.
 *
 * @param priority - Display priority / 表示用優先度
 * @returns Pattern string such as ⬛⬛⬛ / パターン文字列
 */
export function renderPattern(priority: ConcernPriority): string {
  return PATTERN[priority];
}

/**
 * Builds the 6-key search item from a concern.
 *
 * @param concern - Source concern fields / 元の懸念
 * @returns Search hit JSON / 検索結果アイテム
 */
export function toSearchItem(concern: {
  id: number;
  title: string;
  severity: Severity;
  originTaskId: number | null;
  createdTaskId: number | null;
}): ConcernSearchItem {
  const relatedTasks = countRelatedTasks(concern);
  const priority = toPriority(concern.severity);
  return {
    id: concern.id,
    title: concern.title,
    impactScore: computeImpactScore(concern.severity, relatedTasks),
    relatedTasks,
    priority,
    pattern: renderPattern(priority),
  };
}
