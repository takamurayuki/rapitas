/**
 * weekly-review.types
 *
 * Shared frontend types for the AI weekly review feature (Tier S #3).
 * Mirrors the backend WeeklyReview Prisma model and the response shape
 * of /weekly-reviews routes.
 */

/** A single AI-generated weekly review row. */
export interface WeeklyReview {
  id: number;
  weekStart: string; // ISO datetime
  weekEnd: string; // ISO datetime
  summary: string; // narrative review (plain text or Markdown)
  stats: string; // JSON string — aggregated stats
  modelUsed: string;
  generatedAt: string;
  createdAt: string;
}

/** Decoded stats payload (matches backend WeeklyAggregate). */
export interface WeeklyReviewStats {
  weekStart: string;
  weekEnd: string;
  completedTasks: Array<{
    title: string;
    themeName: string | null;
    completedAt: string;
    actualHours: number | null;
    estimatedHours: number | null;
  }>;
  totalCompletedCount: number;
  totalFocusMinutes: number;
  totalTimeEntryMinutes: number;
  pomodoroSessions: number;
  topThemes: Array<{ name: string; count: number }>;
  dailyDistribution: Record<string, number>;
}

/** Response envelopes from the route layer. */
export interface WeeklyReviewSingleResponse {
  success: boolean;
  review: WeeklyReview | null;
  error?: string;
}

export interface WeeklyReviewListResponse {
  success: boolean;
  reviews: WeeklyReview[];
  error?: string;
}
