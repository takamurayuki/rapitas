/**
 * growth-types
 *
 * Shared types for the /agents/growth daily-report archive page: API response
 * shapes of GET /growth/daily-reports and GET /growth/daily-reports/:date.
 */

/** Per-source counts of the report day. */
export interface ReportCounts {
  completed: number;
  mergedPrs: number;
  concerns: number;
  decisions: number;
  restarts: number;
  interventions: number;
}

/** One row of the archive list. */
export interface ReportListItem {
  id: number;
  date: string;
  summary: string;
  satiated: boolean;
  aiFormatted: boolean;
  counts: ReportCounts | null;
  createdAt: string;
}

/** Full report detail for one day. */
export interface ReportDetail {
  id: number;
  date: string;
  summary: string;
  createdAt: string;
  windowStart: string | null;
  windowEnd: string | null;
  aiFormatted: boolean;
  satiated: boolean;
  satiatedReason: string | null;
  counts: ReportCounts | null;
  reportMarkdown: string | null;
}
