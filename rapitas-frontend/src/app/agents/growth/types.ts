/**
 * types
 *
 * Mirrors the GET /agent-metrics/growth-ledger response contract from
 * rapitas-backend/services/self-improvement/growth-ledger-metrics.ts and the
 * GET /agent-metrics/retro-kpi contract from retro-kpi-metrics.ts.
 * Not responsible for any client-side derived/formatted shapes.
 */

/** One weekly window of the self-growth ledger. */
export interface GrowthLedgerWindow {
  /** Inclusive window start (ISO). */
  from: string;
  /** Exclusive window end (ISO). */
  to: string;
  autonomy: { completed: number; autonomous: number; rate: number | null };
  criticFirstPass: {
    research: { total: number; firstPass: number; rate: number | null };
    plan: { total: number; firstPass: number; rate: number | null };
  };
  repairEfficiency: { completedTasks: number; totalRepairs: number; avgPerTask: number | null };
  defectRecurrence: { newConcerns: number; recurring: number; rate: number | null };
  kbQuality: { total: number; validated: number; rate: number | null };
}

/** Full growth ledger API response payload. */
export interface GrowthLedger {
  windowDays: number;
  /** Newest window first, as returned by the API. */
  windows: GrowthLedgerWindow[];
}

/** One weekly window of the self-improvement KPI ledger (retro-kpi-metrics.ts). */
export interface RetroKpiWindow {
  /** Inclusive window start (ISO). */
  from: string;
  /** Exclusive window end (ISO). */
  to: string;
  repairRate: { completedTasks: number; repairedTasks: number; rate: number | null };
  autoMerged: number;
  autoMergeExhausted: number;
  autoMergeConflictFiled: number;
  verifyNoChangeConfirmed: number;
  verifyRepairNonConvergence: number;
  leadTimeMinutes: { sampleSize: number; medianMinutes: number | null };
}

/** Full retro KPI ledger API response payload. */
export interface RetroKpiLedger {
  windowDays: number;
  /** Newest window first, as returned by the API. */
  windows: RetroKpiWindow[];
}

/**
 * Which way a KPI should move to count as an improvement. `neutral` is for
 * series whose rise or fall cannot be judged good or bad on its own.
 */
export type ImprovementDirection = 'higher_is_better' | 'lower_is_better' | 'neutral';
