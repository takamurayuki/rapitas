/**
 * parallel-types
 *
 * Shared types for running more than one task per theme (task 1552): the
 * parallel-safety filter contract that selectNextTask accepts, and the
 * companion-slot record stored in ThemeAutoRun.companionTasksJson.
 * Not responsible for any behaviour.
 */

/** One candidate the parallel-safety filter refused, and why. */
export interface ParallelRejection {
  taskId: number;
  /** Machine-readable reason id, e.g. `file_overlap`. / 理由の識別子 */
  reason: string;
  /** Human-readable detail (files, task ids). / 詳細 */
  detail: string;
}

/** Verdict of {@link ParallelFilter} for one candidate. */
export type ParallelVerdict = { ok: true } | { ok: false; reason: string; detail: string };

/**
 * Parallel-safety filter for selectNextTask: refuses a candidate that would
 * collide with a task already running (same files, dependency, conflict-prone
 * file, same folder, import relation).
 */
export type ParallelFilter = (candidate: {
  id: number;
  status: string;
}) => Promise<ParallelVerdict>;

/** One companion task (a 2nd+ running task of a theme). */
export interface CompanionSlot {
  taskId: number;
  /** Epoch ms the task joined the slot set — its tenure origin. / 在籍開始時刻 */
  since: number;
}

/** Snapshot of a theme's running set: the head plus its companions. */
export interface ThemeActiveSet {
  /** ThemeAutoRun.currentTaskId — the head. / 先頭タスク */
  headTaskId: number | null;
  companions: CompanionSlot[];
  /** The companionTasksJson value read, used as the compare-and-set guard. */
  raw: string | null;
  /** False when the row could not be read (treat as "no companions"). */
  readable: boolean;
}
