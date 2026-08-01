/**
 * IdeaBoxTypes
 *
 * Shared domain types for the IdeaBox feature (ideas, stats, scope, priority).
 */

export type IdeaScope = 'global' | 'project';
export type IdeaPriority = 'urgent' | 'high' | 'medium' | 'low';
/**
 * Status-tab filter for the idea list. 'uncategorized' is not a lifecycle
 * state — it selects themeless (scope: global) ideas, which auto-run never
 * promotes to tasks until a human assigns them a theme.
 */
export type IdeaStatusFilter = 'open' | 'used' | 'all' | 'uncategorized';

export interface Idea {
  id: number;
  title: string;
  content: string;
  category: string;
  scope: IdeaScope;
  priority: IdeaPriority;
  tags: string[];
  themeId: number | null;
  source: string;
  usedInTaskId: number | null;
  createdAt: string;
}

export interface IdeaStats {
  total: number;
  unused: number;
}
