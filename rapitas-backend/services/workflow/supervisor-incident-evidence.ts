/**
 * supervisor-incident-evidence
 *
 * Evidence gathering for the four supervisor-derived incident signatures:
 * assembles one task's cwd/theme pair, failure-mark vs success-artifact
 * timestamps, hang-backstop vs last-progress timestamps, and verify-checklist
 * stats from the DB. Runs NO detection logic — that lives in
 * supervisor-incident-detectors; this module is the I/O boundary.
 */
import { prisma } from '../../config/database';
import { analyzeVerifyChecklist, type VerifyChecklistStats } from './supervisor-incident-detectors';

/** How much of an execution output head is scanned for the cwd line. */
const OUTPUT_HEAD_CHARS = 4000;

/** Notification types that mark a task as terminally failed on the auto-run path. */
const FAILURE_NOTIFICATION_TYPES = ['auto_run_task_skipped', 'auto_run_hang_backstop'] as const;

/**
 * Provider-agnostic match for the runner's first log line, e.g.
 * `[Claude Code] Working directory: C:\...` (claude-code) or the codex
 * equivalent — the prefix inside the brackets is deliberately not pinned.
 */
const WORKING_DIRECTORY_LINE = /\[[^\]]+\]\s*Working directory:\s*(.+)/;

/** Everything the four supervisor detectors need to know about one task. */
export interface SupervisorEvidence {
  /** The task's theme workingDirectory (null = unset theme or no theme). */
  themeWorkingDirectory: string | null;
  /** cwd parsed from the latest execution's output head (null = not found). */
  executionCwd: string | null;
  /** The raw matched `Working directory` line, for the concern's evidence. */
  executionCwdLine: string | null;
  /** Latest terminal failure mark, epoch ms (max across queue item + notifications). */
  failureMarkedAtMs: number | null;
  /** Which source produced failureMarkedAtMs, for the concern's evidence. */
  failureMarkSource: string | null;
  /** Earliest success artifact (linked PR / auto_pr_created log), epoch ms. */
  successArtifactAtMs: number | null;
  /** Human-readable reference to the success artifact (PR number/URL). */
  successArtifactRef: string | null;
  /** Latest auto_run_hang_backstop notification for this task, epoch ms. */
  backstopAtMs: number | null;
  /** Latest phase_completed:* transition at or before the backstop, epoch ms. */
  lastProgressAtMs: number | null;
  /** That transition's cause (e.g. phase_completed:implementer). */
  lastProgressCause: string | null;
  /** Verify checklist aggregate for the misplacement detector. */
  verifyChecklist: VerifyChecklistStats;
}

/**
 * Runs one query defensively: BOTH async rejections and synchronous throws
 * collapse to the fallback. The existing `.catch()` style only covers
 * rejections — a mocked/partial prisma where a model is undefined throws
 * synchronously and would otherwise take the whole gathering (and the caller's
 * other findings) down with it.
 *
 * @param fn - Query thunk. / クエリ実行関数
 * @param fallback - Value on any failure. / 失敗時の値
 * @returns Query result or the fallback. / 結果またはフォールバック
 */
export async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/**
 * Extracts the working directory from an execution output head.
 *
 * @param outputHead - First chunk of AgentExecution.output. / 実行出力の先頭
 * @returns The cwd and the raw matched line, or null. / cwdと該当行、無ければnull
 */
export function parseWorkingDirectory(
  outputHead: string | null,
): { cwd: string; line: string } | null {
  if (!outputHead) return null;
  const match = WORKING_DIRECTORY_LINE.exec(outputHead);
  if (!match) return null;
  const cwd = (match[1] ?? '').trim();
  if (!cwd) return null;
  return { cwd, line: match[0].trim() };
}

/** Max epoch ms among the given candidates, or null when none exist. */
function maxMs(...candidates: (number | null)[]): number | null {
  const present = candidates.filter((c): c is number => c !== null);
  return present.length > 0 ? Math.max(...present) : null;
}

/**
 * Collects the supervisor-signature evidence for one task. Gated to keep the
 * watch pass cheap: the execution output is fetched only when the theme has a
 * working directory, success artifacts only when a failure mark exists, and
 * the progress transition only when a backstop notification exists. Every
 * query degrades to partial evidence via safeQuery.
 *
 * @param task - Candidate task (id only is read). / 対象タスク
 * @returns The gathered evidence snapshot. / 収集済み証拠スナップショット
 */
export async function gatherSupervisorEvidence(task: { id: number }): Promise<SupervisorEvidence> {
  // --- A: theme working directory + execution cwd -------------------------
  const taskRow = await safeQuery(
    () =>
      prisma.task.findUnique({
        where: { id: task.id },
        select: { theme: { select: { workingDirectory: true } } },
      }),
    null,
  );
  const themeWorkingDirectory = taskRow?.theme?.workingDirectory ?? null;

  let executionCwd: string | null = null;
  let executionCwdLine: string | null = null;
  if (themeWorkingDirectory !== null) {
    const latestExec = await safeQuery(
      () =>
        prisma.agentExecution.findFirst({
          where: { session: { config: { taskId: task.id } } },
          orderBy: { createdAt: 'desc' },
          select: { output: true },
        }),
      null,
    );
    const parsed = parseWorkingDirectory(latestExec?.output?.slice(0, OUTPUT_HEAD_CHARS) ?? null);
    executionCwd = parsed?.cwd ?? null;
    executionCwdLine = parsed?.line ?? null;
  }

  // --- B (failure side) + C (backstop): terminal failure marks ------------
  const failedQueueItem = await safeQuery(
    () =>
      prisma.workflowQueueItem.findFirst({
        where: {
          taskId: task.id,
          status: { in: ['failed', 'cancelled'] },
          completedAt: { not: null },
        },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true, status: true },
      }),
    null,
  );
  // NOTE: The dedup keys embed as `"dedupKey":"<type>:<taskId>"` — matching
  // WITH the closing quote is what keeps task 585 from matching task 5850.
  const skippedNotification = await safeQuery(
    () =>
      prisma.notification.findFirst({
        where: {
          type: 'auto_run_task_skipped',
          metadata: { contains: `${FAILURE_NOTIFICATION_TYPES[0]}:${task.id}"` },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    null,
  );
  const backstopNotification = await safeQuery(
    () =>
      prisma.notification.findFirst({
        where: {
          type: 'auto_run_hang_backstop',
          metadata: { contains: `${FAILURE_NOTIFICATION_TYPES[1]}:${task.id}"` },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    null,
  );
  const backstopAtMs = backstopNotification?.createdAt.getTime() ?? null;

  const queueFailedAtMs = failedQueueItem?.completedAt?.getTime() ?? null;
  const skippedAtMs = skippedNotification?.createdAt.getTime() ?? null;
  const failureMarkedAtMs = maxMs(queueFailedAtMs, skippedAtMs, backstopAtMs);
  let failureMarkSource: string | null = null;
  if (failureMarkedAtMs !== null) {
    if (failureMarkedAtMs === queueFailedAtMs) {
      failureMarkSource = `WorkflowQueueItem(${failedQueueItem?.status}).completedAt`;
    } else if (failureMarkedAtMs === skippedAtMs) {
      failureMarkSource = 'Notification(auto_run_task_skipped)';
    } else {
      failureMarkSource = 'Notification(auto_run_hang_backstop)';
    }
  }

  // --- B (success side): only meaningful when a failure mark exists -------
  let successArtifactAtMs: number | null = null;
  let successArtifactRef: string | null = null;
  if (failureMarkedAtMs !== null) {
    // NOTE: PRs are scoped by linkedTaskId (typed column), never by prNumber —
    // a prNumber-only lookup once fetched another repository's same-numbered PR.
    const linkedPr = await safeQuery(
      () =>
        prisma.gitHubPullRequest.findFirst({
          where: { linkedTaskId: task.id },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true, prNumber: true, url: true },
        }),
      null,
    );
    const autoPrLog = await safeQuery(
      () =>
        prisma.activityLog.findFirst({
          where: { taskId: task.id, action: 'auto_pr_created' },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
      null,
    );
    const prAtMs = linkedPr?.createdAt.getTime() ?? null;
    const logAtMs = autoPrLog?.createdAt.getTime() ?? null;
    if (prAtMs !== null && (logAtMs === null || prAtMs <= logAtMs)) {
      successArtifactAtMs = prAtMs;
      successArtifactRef = `PR #${linkedPr?.prNumber} (${linkedPr?.url})`;
    } else if (logAtMs !== null) {
      successArtifactAtMs = logAtMs;
      successArtifactRef = linkedPr
        ? `PR #${linkedPr.prNumber} (${linkedPr.url})`
        : 'ActivityLog(auto_pr_created)';
    }
  }

  // --- C (progress side): only meaningful when a backstop exists ----------
  let lastProgressAtMs: number | null = null;
  let lastProgressCause: string | null = null;
  if (backstopAtMs !== null) {
    const progress = await safeQuery(
      () =>
        prisma.workflowTransition.findFirst({
          where: {
            taskId: task.id,
            cause: { startsWith: 'phase_completed:' },
            createdAt: { lte: new Date(backstopAtMs) },
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, cause: true },
        }),
      null,
    );
    lastProgressAtMs = progress?.createdAt.getTime() ?? null;
    lastProgressCause = progress?.cause ?? null;
  }

  // --- D: verify checklist ------------------------------------------------
  const verifyFile = await safeQuery(
    () =>
      prisma.workflowFile.findFirst({
        where: { taskId: task.id, fileType: 'verify' },
        select: { content: true },
      }),
    null,
  );

  return {
    themeWorkingDirectory,
    executionCwd,
    executionCwdLine,
    failureMarkedAtMs,
    failureMarkSource,
    successArtifactAtMs,
    successArtifactRef,
    backstopAtMs,
    lastProgressAtMs,
    lastProgressCause,
    verifyChecklist: analyzeVerifyChecklist(verifyFile?.content ?? null),
  };
}
