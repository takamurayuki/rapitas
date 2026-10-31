/**
 * StartupReadiness
 *
 * Whether the server has finished its post-listen warm-up, so "the port
 * answers" can be told apart from "the server is ready to be written to".
 * Not responsible for running the warm-up — index.ts owns that sequence and
 * reports into this module.
 *
 * Why this exists (#1323): warm-up runs AFTER the listener opens, deliberately,
 * so a page open across a restart is not stalled by CPU-heavy init. But several
 * of those tasks write (memory-system, ai-orchestra-recovery,
 * legacy-workflow-migration, startup-backfills) and one spawns a second process
 * with its own Prisma connection (agent-worker-manager). On SQLite that window
 * produced `SQLITE_IOERR_SHORT_READ (522)` for a write arriving from outside —
 * while `/health` reported `status: "healthy", database: "connected"`, because
 * connectivity is not writability.
 */

/** False until the whole warm-up sequence has settled. */
let warmupComplete = false;

/** The task currently in flight, for diagnosing a warm-up that never finishes. */
let currentStage: string | null = null;

/** When the warm-up finished, to report how long the window actually was. */
let completedAtMs: number | null = null;

/**
 * Record which warm-up task is running.
 *
 * @param label - The task's label, as index.ts names it / ウォームアップ項目名
 */
export function markWarmupStage(label: string): void {
  currentStage = label;
}

/**
 * Record that warm-up has finished. Idempotent: the first call wins, so a
 * second invocation cannot reopen the window or move the recorded time.
 */
export function markWarmupComplete(): void {
  if (warmupComplete) return;
  warmupComplete = true;
  currentStage = null;
  completedAtMs = Date.now();
}

/** Whether warm-up has finished. / ウォームアップ完了済みか */
export function isWarmupComplete(): boolean {
  return warmupComplete;
}

/** Readiness detail for the health payload. */
export interface ReadinessSnapshot {
  /** True once every warm-up task has settled. */
  ready: boolean;
  /** The task in flight, or null when ready (or before the first one starts). */
  warmupStage: string | null;
  /** Milliseconds from process start to readiness, or null while warming. */
  readyAfterMs: number | null;
}

/**
 * The current readiness, for `/health` to report.
 *
 * @returns Readiness flag plus the in-flight stage / 準備状態と進行中の項目
 */
export function getReadinessSnapshot(): ReadinessSnapshot {
  return {
    ready: warmupComplete,
    // A ready server never names a stage, even if a late marker arrived after
    // completion — `ready` is the contract, and the stage only explains a
    // window that has not closed yet.
    warmupStage: warmupComplete ? null : currentStage,
    readyAfterMs:
      completedAtMs === null ? null : Math.max(0, Math.round(completedAtMs - startedAtMs)),
  };
}

/** Process start, captured at import so readiness latency is measurable. */
const startedAtMs = Date.now() - Math.round(process.uptime() * 1000);

/**
 * Reset to the pre-warm-up state. Tests only — the real process goes through
 * this transition exactly once.
 */
export function resetReadinessForTests(): void {
  warmupComplete = false;
  currentStage = null;
  completedAtMs = null;
}
