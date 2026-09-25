/**
 * self-incident-watcher
 *
 * Detection-only incident pass riding the workflow-reconciler's 60s cycle,
 * self-throttled to once per ~5 minutes: scans tasks updated within the last
 * 24h, runs the pure signature detectors over each one's gathered evidence,
 * and files a dedup-keyed concern per finding. A separate no-lookback scan
 * re-notifies tasks stuck on an unanswered intake question. NEVER repairs
 * state — the concern → task → workflow pipeline is the repair path (by design).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { notifyIntakeQuestionPending } from '../communication/notification-service';
import { detectUnansweredQuestion, REPEAT_LOOP_MIN_COUNT } from './incident-signature-detectors';
import { resolveMaxRepairs } from './verify-self-repair-budget';
import { DEFAULT_MAX_CI_REPAIRS } from './blocked-task-policy';
import type { CandidateTask } from './self-incident-file-finding';
import { inspectTask } from './self-incident-inspect-task';
import {
  resolveArmedThemeIds,
  resolveDisabledAutoRunThemeIds,
  resolveNonDevelopmentThemeIds,
  resolveWorkflowDisabledGlobally,
  resolveThemeAutoRunRunState,
} from './self-incident-watch-gates';

const log = createLogger('self-incident-watcher');

/** Only tasks updated within this window are inspected (default 24h). */
export const CANDIDATE_LOOKBACK_MS =
  parseInt(process.env.RAPITAS_INCIDENT_LOOKBACK_MS ?? '', 10) || 24 * 60 * 60 * 1000;

/** Minimum interval between two watch passes (default 5m). */
export const WATCH_INTERVAL_MS =
  parseInt(process.env.RAPITAS_INCIDENT_WATCH_INTERVAL_MS ?? '', 10) || 5 * 60 * 1000;

/**
 * Defensive per-pass scan cap. Combined with `orderBy updatedAt asc`, an
 * overflow defers the FRESHEST tasks (least likely to be stagnant) to the
 * next pass rather than dropping the stalest ones.
 */
const MAX_CANDIDATES = 200;

// Process-local throttle (same pattern as the reconciler's `inFlight`): a
// restart resets it, which merely allows one early pass — harmless, since the
// watcher only detects (no state change) and dedupKey absorbs re-detections.
let lastRunMs = 0;

/**
 * Pure throttle decision: has enough time passed since the last watch pass?
 *
 * @param lastRunMs - When the previous pass ran (ms; 0 = never). / 前回実行時刻
 * @param nowMs - Current time (ms). / 現在時刻
 * @param intervalMs - Minimum interval (default 5m). / 最小間隔
 * @returns true when a new pass may run. / 実行してよいか
 */
export function shouldRunIncidentWatch(
  lastRunMs: number,
  nowMs: number,
  intervalMs: number = WATCH_INTERVAL_MS,
): boolean {
  return nowMs - lastRunMs >= intervalMs;
}

/**
 * Dedicated scan for tasks paused on an intake question. These CANNOT ride the
 * main candidate query: updatedAt freezes when the question is raised, so
 * after CANDIDATE_LOOKBACK_MS (24h) the task silently drops out of the
 * lookback — exactly the tasks this detector exists for (#578/#579 sat 4
 * days). No lookback here; the workflowStatus filter keeps the set small.
 * Re-notifies via createNotification only — filing a concern would promote
 * into a code-fix task that can only report "対象コードなし" (task 587 shape);
 * the sole fix for an unanswered question is a human answer.
 */
async function inspectAwaitingQuestionTasks(nowMs: number): Promise<number> {
  const candidates = await prisma.task
    .findMany({
      where: { parentId: null, workflowStatus: 'awaiting_question' },
      select: {
        id: true,
        title: true,
        status: true,
        workflowStatus: true,
        updatedAt: true,
        themeId: true,
        workflowDisabled: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: MAX_CANDIDATES,
    })
    .catch(() => [] as CandidateTask[]);

  let notified = 0;
  for (const task of candidates) {
    try {
      // Wait clock = when the question was raised, NOT task.updatedAt —
      // enrichment and other side channels touch updatedAt without answering.
      const raised = await prisma.workflowTransition.findFirst({
        where: { taskId: task.id, toStatus: 'awaiting_question' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      // Second guard besides the workflowStatus filter: an answered task must
      // never re-notify, even if its status lags behind the answer.
      const answered = await prisma.workflowTransition.findFirst({
        where: { taskId: task.id, cause: 'intake_question_answered' },
        select: { id: true },
      });
      const finding = detectUnansweredQuestion({
        workflowStatus: task.workflowStatus,
        taskStatus: task.status,
        questionRaisedAtMs: raised ? raised.createdAt.getTime() : null,
        hasAnsweredQuestion: answered !== null,
        nowMs,
      });
      if (!finding) continue;
      // Dedup lives in the helper: the same title+link window also covers the
      // intake gate's initial notice, so this is at most one notice per window.
      const created = await notifyIntakeQuestionPending({
        taskId: task.id,
        taskTitle: task.title,
        nowMs,
      });
      if (created) {
        notified++;
        log.info(
          { taskId: task.id, staleMs: finding.staleMs },
          '[self-incident] re-notified an unanswered intake question',
        );
      }
    } catch (err) {
      // One broken task must not starve the rest of the scan.
      log.warn(
        { err, taskId: task.id },
        '[self-incident] awaiting-question inspection failed — continuing',
      );
    }
  }
  return notified;
}

/**
 * Runs one self-incident watch pass (throttled). Scans tasks updated within
 * the lookback window, oldest first, and files evidence-backed concerns for
 * every detected signature; a second no-lookback scan re-notifies stale
 * unanswered intake questions. Detection only — no state is repaired here.
 *
 * @param nowMs - Current time (ms); injectable for tests. / 現在時刻
 * @returns Surfaced findings: concerns filed + question re-notifications (0 when throttled). / 起票＋通知の合計件数
 */
export async function runSelfIncidentWatch(nowMs: number = Date.now()): Promise<number> {
  if (!shouldRunIncidentWatch(lastRunMs, nowMs)) return 0;
  lastRunMs = nowMs;

  const candidates = await prisma.task
    .findMany({
      where: { parentId: null, updatedAt: { gte: new Date(nowMs - CANDIDATE_LOOKBACK_MS) } },
      select: {
        id: true,
        title: true,
        status: true,
        workflowStatus: true,
        updatedAt: true,
        themeId: true,
        workflowDisabled: true,
        haltReason: true,
        autoRunExcluded: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: MAX_CANDIDATES,
    })
    .catch(() => [] as CandidateTask[]);

  // Resolved once per pass (not per task) — feeds Pattern B's auto-run gate
  // and the stagnation isWorkflowManaged gate (#860).
  const candidateThemeIds = [
    ...new Set(candidates.map((t) => t.themeId).filter((id): id is number => id != null)),
  ];
  const [
    disabledAutoRunThemeIds,
    nonDevelopmentThemeIds,
    workflowDisabledGlobally,
    themeAutoRunRunState,
    armedThemeIds,
  ] = await Promise.all([
    resolveDisabledAutoRunThemeIds(candidateThemeIds),
    resolveNonDevelopmentThemeIds(candidateThemeIds),
    resolveWorkflowDisabledGlobally(),
    resolveThemeAutoRunRunState(candidateThemeIds),
    resolveArmedThemeIds(candidateThemeIds),
  ]);

  // Resolved once per pass, not per task (task 837, generalizes task 835's
  // verify_repair-only budget guard to also cover ci_repair): a task that
  // legitimately exhausts its verify_repair/ci_repair budget must not be
  // misreported as a repeat loop — see detectRepeatLoop's task-837 JSDoc
  // paragraph. Falls back to the default budget when the settings row is
  // missing/unreadable (see resolveMaxRepairs).
  const verifyRepairLimit = await resolveMaxRepairs();
  const repairBounceMinCount = Math.max(
    REPEAT_LOOP_MIN_COUNT,
    Math.max(verifyRepairLimit, DEFAULT_MAX_CI_REPAIRS) + 1,
  );

  let filed = 0;
  for (const task of candidates) {
    try {
      filed += await inspectTask(
        task,
        nowMs,
        disabledAutoRunThemeIds,
        nonDevelopmentThemeIds,
        workflowDisabledGlobally,
        repairBounceMinCount,
        themeAutoRunRunState,
        armedThemeIds,
      );
    } catch (err) {
      // One broken task must not starve the rest of the scan.
      log.warn({ err, taskId: task.id }, '[self-incident] task inspection failed — continuing');
    }
  }

  // Runs AFTER the main loop: awaiting_question tasks age out of the 24h
  // lookback above, so they need their own no-lookback pass (see the fn doc).
  const notified = await inspectAwaitingQuestionTasks(nowMs);

  if (filed + notified > 0) {
    log.info(
      { filed, notified, candidates: candidates.length },
      '[self-incident] surfaced incident findings',
    );
  }
  return filed + notified;
}
