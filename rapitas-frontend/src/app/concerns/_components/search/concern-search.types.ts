/**
 * concern-search.types
 *
 * Types for the PERF concern search UI. Mirrors the JSON contract of
 * GET /concerns/search (backend concern-search-score.ts).
 */

export type ConcernPriority = 'Critical' | 'High' | 'Medium' | 'Low';

export interface ConcernSearchItem {
  id: number;
  title: string;
  impactScore: number;
  relatedTasks: number;
  priority: ConcernPriority;
  pattern: string;
}

export interface ParsedConcernQuery {
  type: 'bug' | 'refactor' | 'security' | 'perf' | 'other' | undefined;
  severities: ('urgent' | 'high' | 'medium' | 'low')[];
  keywords: string[];
}

export interface ConcernSearchResponse {
  items: ConcernSearchItem[];
  total: number;
  parsed: ParsedConcernQuery;
}
