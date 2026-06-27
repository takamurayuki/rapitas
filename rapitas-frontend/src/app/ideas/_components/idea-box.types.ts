/**
 * IdeaBoxTypes
 *
 * Shared domain types for the IdeaBox feature (ideas, stats, scope, priority).
 */

export type IdeaScope = 'global' | 'project';
export type IdeaPriority = 'urgent' | 'high' | 'medium' | 'low';

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
