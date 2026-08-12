/**
 * types
 *
 * Mirrors the GET /agent-metrics/growth-ledger response contract from
 * rapitas-backend/services/self-improvement/growth-ledger-metrics.ts.
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
