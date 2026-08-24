/**
 * Completion Diff Query
 *
 * Classifies completed tasks by whether they actually landed a code diff on
 * their branch, by joining Task.completedAt with the latest
 * ActivityLog(action='auto_commit_created') row per task — the row written by
 * logAutoCommit() with the filesChanged/additions/deletions/alreadyCommitted
 * stats produced by createCommit(). Read-only; does not mutate any rows and
 * requires no schema change, so past completions are covered retroactively.
 */

import { prisma } from '../../../../config/database';

/**
 * Diff outcome of one completed task.
 * - has_diff: latest auto-commit log reports filesChanged > 0
 * - zero_diff: latest auto-commit log reports filesChanged === 0
 * - unknown: no auto-commit log row exists, or its metadata is unparseable /
 *   malformed (distinct from zero_diff so "no data" is never counted as a
 *   confirmed empty completion)
 */
export type CompletionDiffClassification = 'has_diff' | 'zero_diff' | 'unknown';

/** Completed-task input row for the pure aggregation. */
export interface CompletionDiffTaskInput {
  taskId: number;
  title: string;
  completedAt: Date;
}

/** auto_commit_created ActivityLog input row for the pure aggregation. */
export interface CompletionDiffActivityLogInput {
  taskId: number;
  /** Used to pick the latest attempt when a task auto-committed more than once. */
  logId: number;
  createdAt: Date;
  metadata: string | null;
}

/** Per-task classification result with the raw diff stats for reference. */
export interface CompletionDiffEntry {
  taskId: number;
  title: string;
  /** ISO-8601 completion timestamp. */
  completedAt: string;
  classification: CompletionDiffClassification;
  filesChanged: number | null;
  additions: number | null;
  deletions: number | null;
  alreadyCommitted: boolean | null;
}

/** Aggregated stats over the analyzed completions. */
export interface CompletionDiffStats {
  totalCompletions: number;
  hasDiffCount: number;
  zeroDiffCount: number;
  unknownCount: number;
  /** zeroDiffCount / totalCompletions (0 when nothing analyzed). */
  zeroDiffRate: number;
  entries: CompletionDiffEntry[];
}

/**
 * Parses a JSON string defensively, returning null on any failure so broken
 * metadata degrades to an `unknown` classification instead of throwing.
 */
function safeJsonParse(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Pure aggregation: classify each completed task as has_diff / zero_diff /
 * unknown from its latest auto-commit log row. Kept free of Prisma so it can
 * be unit-tested against fixture arrays.
 *
 * Classification uses filesChanged only; additions/deletions/alreadyCommitted
 * are carried through as reference data but never influence the bucket.
 *
 * @param tasks - Completed tasks to classify / 分類対象の完了タスク
 * @param activityLogs - auto_commit_created rows (pre-filtered by action) / auto-commitログ行
 * @returns Aggregated diff stats / 集計された差分統計
 */
export function computeCompletionDiffStats(
  tasks: CompletionDiffTaskInput[],
  activityLogs: CompletionDiffActivityLogInput[],
): CompletionDiffStats {
  const logsByTask = new Map<number, CompletionDiffActivityLogInput[]>();
  for (const row of activityLogs) {
    const bucket = logsByTask.get(row.taskId);
    if (bucket) bucket.push(row);
    else logsByTask.set(row.taskId, [row]);
  }

  let hasDiffCount = 0;
  let zeroDiffCount = 0;
  let unknownCount = 0;

  const entries: CompletionDiffEntry[] = tasks.map((task) => {
    const logs = logsByTask.get(task.taskId) ?? [];

    let classification: CompletionDiffClassification = 'unknown';
    let filesChanged: number | null = null;
    let additions: number | null = null;
    let deletions: number | null = null;
    let alreadyCommitted: boolean | null = null;

    if (logs.length > 0) {
      // createdAt desc with logId as tiebreaker — same-millisecond retries would
      // otherwise sort nondeterministically and could resurface a stale attempt.
      const latest = logs.reduce((a, b) => {
        const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
        if (timeDiff > 0) return b;
        if (timeDiff < 0) return a;
        return b.logId > a.logId ? b : a;
      });
      const parsed = safeJsonParse(latest.metadata);
      const rawFiles = parsed?.filesChanged;
      filesChanged =
        typeof rawFiles === 'number' && !Number.isNaN(rawFiles) && rawFiles >= 0 ? rawFiles : null;

      if (filesChanged === null) classification = 'unknown';
      else if (filesChanged === 0) classification = 'zero_diff';
      else classification = 'has_diff';

      additions = typeof parsed?.additions === 'number' ? parsed.additions : null;
      deletions = typeof parsed?.deletions === 'number' ? parsed.deletions : null;
      alreadyCommitted =
        typeof parsed?.alreadyCommitted === 'boolean' ? parsed.alreadyCommitted : null;
    }

    if (classification === 'has_diff') hasDiffCount++;
    else if (classification === 'zero_diff') zeroDiffCount++;
    else unknownCount++;

    return {
      taskId: task.taskId,
      title: task.title,
      completedAt: task.completedAt.toISOString(),
      classification,
      filesChanged,
      additions,
      deletions,
      alreadyCommitted,
    };
  });

  const totalCompletions = tasks.length;
  return {
    totalCompletions,
    hasDiffCount,
    zeroDiffCount,
    unknownCount,
    zeroDiffRate: totalCompletions > 0 ? round4(zeroDiffCount / totalCompletions) : 0,
    entries,
  };
}

/**
 * Loads the most recent completed tasks and their auto-commit logs, then
 * delegates to computeCompletionDiffStats. Read-only — two Prisma queries,
 * no writes.
 *
 * @param limit - Max completed tasks to analyze, newest first / 分析対象の最大件数
 * @returns Aggregated diff stats / 集計された差分統計
 */
export async function getCompletionDiffStats(limit = 500): Promise<CompletionDiffStats> {
  const tasks = await prisma.task.findMany({
    where: { completedAt: { not: null } },
    select: { id: true, title: true, completedAt: true },
    orderBy: { completedAt: 'desc' },
    take: limit,
  });

  if (tasks.length === 0) {
    return computeCompletionDiffStats([], []);
  }

  const taskIds = tasks.map((t) => t.id);
  const logs = await prisma.activityLog.findMany({
    where: { taskId: { in: taskIds }, action: 'auto_commit_created' },
    select: { id: true, taskId: true, createdAt: true, metadata: true },
  });

  const taskInputs: CompletionDiffTaskInput[] = tasks.map((t) => ({
    taskId: t.id,
    title: t.title,
    // completedAt is non-null at runtime (filtered by the where clause);
    // Prisma's generated type does not narrow it, hence the assertion.
    completedAt: t.completedAt as Date,
  }));

  const logInputs: CompletionDiffActivityLogInput[] = logs.map((l) => ({
    // taskId is Int? in the schema but `taskId: { in: taskIds }` excludes null rows.
    taskId: l.taskId as number,
    logId: l.id,
    createdAt: l.createdAt,
    metadata: l.metadata,
  }));

  return computeCompletionDiffStats(taskInputs, logInputs);
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
