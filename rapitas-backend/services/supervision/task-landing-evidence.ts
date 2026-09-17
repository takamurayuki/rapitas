/**
 * TaskLandingEvidence
 *
 * Reads task outcome evidence (completion/verify/merge/stop transitions, the PR
 * mirror, parentId/acceptanceCriteria and the automation policy), classifies each
 * completed task's landing and routes the result into the streak inputs. A raw
 * `completed` transition is never counted by itself.
 * Not responsible for the classification rules — see task-landing-classifier.ts.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { resolveAutomationPolicy } from '../workflow/automation-policy';
import type { NonQualifyingEvent, PendingLanding, TimedTaskEvent } from './streak-calculator';
import {
  LANDING_CLASSES,
  LANDING_FAILURE_CAUSES,
  MERGED_PR_STATES,
  PUBLISH_CAUSES,
  STOP_CAUSE_PATTERNS,
  VERIFY_PASS_CAUSES,
  classifyTaskLanding,
  type LandingClass,
  type TaskLandingResult,
} from './task-landing-classifier';

const log = createLogger('supervision:task-landing-evidence');

/**
 * Transition causes meaning a task failed or was interrupted. Internal repair
 * loops (verify_repair, *_critic_failed) are excluded: they still end in an
 * independent verification, so they are not a failed outcome by themselves.
 * The stop patterns are the same set the classifier uses for publish-after-stop.
 */
const FAILURE_CAUSE_PATTERNS: readonly RegExp[] = [
  /^phase_failed:/,
  /exhausted$/,
  /non_convergence$/,
  /hang_backstop$/,
  /budget_exceeded$/,
  ...STOP_CAUSE_PATTERNS,
  /^task_vanished$/,
  /^subtask_failed$/,
  /^verify_no_changes$/,
];

/**
 * Whether a transition cause marks a failed or interrupted task outcome.
 *
 * @param cause - WorkflowTransition.cause / 遷移のcause
 * @returns true for failure/interruption / 失敗・中断なら true
 */
export function isFailureCause(cause: string): boolean {
  return FAILURE_CAUSE_PATTERNS.some((p) => p.test(cause));
}

export interface TaskLandingEvidence {
  completions: TimedTaskEvent[];
  interventions: TimedTaskEvent[];
  failures: TimedTaskEvent[];
  nonQualifying: NonQualifyingEvent[];
  pending: PendingLanding[];
  subtaskExcluded: number[];
  classCounts: Record<LandingClass, number>;
  landings: TaskLandingResult[];
  blockingTaskIds: number[];
}

type OutcomeRow = { taskId: number; toStatus: string; cause: string; createdAt: Date };

/** Routes one classified landing into the streak input it belongs to. */
function route(r: TaskLandingResult, out: TaskLandingEvidence): void {
  const at = r.at ?? new Date(0);
  const code = r.reasonCode ?? 'landing_evidence_unobservable';
  switch (r.landingClass) {
    case 'qualified':
      out.completions.push({ at, taskId: r.taskId });
      break;
    case 'manual_merge':
      out.interventions.push({ at, taskId: r.taskId });
      break;
    case 'landing_failed':
      out.failures.push({ at, taskId: r.taskId });
      break;
    case 'unverified_completion':
    case 'publish_after_stop':
      out.nonQualifying.push({
        at,
        taskId: r.taskId,
        kind: 'integrity_violation',
        reasonCode: code,
      });
      break;
    case 'criteria_missing':
    case 'merge_not_requested':
      out.nonQualifying.push({
        at,
        taskId: r.taskId,
        kind: 'non_qualifying_completion',
        reasonCode: code,
      });
      break;
    case 'landing_pending':
    case 'policy_unreadable':
      out.pending.push({ taskId: r.taskId, reasonCode: code });
      break;
    case 'subtask':
      out.subtaskExcluded.push(r.taskId);
      break;
  }
}

/**
 * Collects and classifies landing evidence for every task completed in the window.
 *
 * @param lookbackStart - Window start / 集計開始時刻
 * @returns Streak inputs split by landing class / 着地分類ごとのストリーク入力
 */
export async function gatherTaskLandingEvidence(lookbackStart: Date): Promise<TaskLandingEvidence> {
  const [outcomes, blockedTasks] = await Promise.all([
    prisma.workflowTransition.findMany({
      where: {
        createdAt: { gte: lookbackStart },
        OR: [
          { toStatus: 'completed' },
          { cause: { startsWith: 'phase_failed:' } },
          { cause: { endsWith: 'exhausted' } },
          { cause: { endsWith: 'non_convergence' } },
          { cause: { endsWith: 'hang_backstop' } },
          { cause: { endsWith: 'budget_exceeded' } },
          { cause: { endsWith: '_revert' } },
          { cause: { in: ['task_vanished', 'subtask_failed', 'verify_no_changes'] } },
        ],
      },
      select: { taskId: true, toStatus: true, cause: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20_000,
    }) as Promise<OutcomeRow[]>,
    // A task left blocked is an unresolved failure even without a matching cause.
    prisma.task.findMany({
      where: { status: 'blocked', updatedAt: { gte: lookbackStart } },
      select: { id: true, updatedAt: true },
      take: 1000,
    }),
  ]);

  const out: TaskLandingEvidence = {
    completions: [],
    interventions: [],
    failures: [],
    nonQualifying: [],
    pending: [],
    subtaskExcluded: [],
    classCounts: Object.fromEntries(LANDING_CLASSES.map((c) => [c, 0])) as Record<
      LandingClass,
      number
    >,
    landings: [],
    blockingTaskIds: [],
  };
  for (const t of outcomes)
    if (isFailureCause(t.cause)) out.failures.push({ at: t.createdAt, taskId: t.taskId });
  for (const task of blockedTasks) out.failures.push({ at: task.updatedAt, taskId: task.id });

  const completedIds = [
    ...new Set(outcomes.filter((t) => t.toStatus === 'completed').map((t) => t.taskId)),
  ];
  if (completedIds.length > 0) {
    const [history, tasks, prRows] = await Promise.all([
      prisma.workflowTransition.findMany({
        where: {
          taskId: { in: completedIds },
          OR: [
            { toStatus: 'completed' },
            {
              cause: { in: [...PUBLISH_CAUSES, ...VERIFY_PASS_CAUSES, ...LANDING_FAILURE_CAUSES] },
            },
            { cause: { endsWith: '_revert' } },
          ],
        },
        select: { taskId: true, toStatus: true, cause: true, createdAt: true },
        take: 20_000,
      }) as Promise<OutcomeRow[]>,
      prisma.task.findMany({
        where: { id: { in: completedIds } },
        select: { id: true, parentId: true, acceptanceCriteria: true },
      }),
      // An unreadable PR mirror must not read as "no PR": every task becomes unobservable.
      prisma.gitHubPullRequest
        .findMany({
          where: { linkedTaskId: { in: completedIds } },
          select: { linkedTaskId: true, state: true },
        })
        .catch((err: unknown) => {
          log.error({ err }, '[Supervision] PR mirror read failed');
          return null;
        }),
    ]);

    const taskById = new Map(tasks.map((t) => [t.id, t]));
    for (const taskId of completedIds) {
      const rows = (prRows ?? []).filter((p) => p.linkedTaskId === taskId);
      const prState = rows.some((p) => MERGED_PR_STATES.includes(p.state))
        ? 'merged'
        : (rows[0]?.state ?? null);
      const autoMergePR =
        prRows === null
          ? null
          : await resolveAutomationPolicy(prisma, taskId)
              .then((p) => p.autoMergePR)
              .catch(() => null);
      let result = classifyTaskLanding({
        taskId,
        parentId: taskById.get(taskId)?.parentId ?? null,
        acceptanceCriteriaRaw: taskById.get(taskId)?.acceptanceCriteria ?? null,
        transitions: history.filter((h) => h.taskId === taskId),
        prState: prRows === null ? null : prState,
        autoMergePR,
      });
      // With the mirror unreadable, a merge can be neither confirmed nor ruled out.
      if (prRows === null && result.landingClass === 'landing_pending') {
        result = {
          ...result,
          landingClass: 'policy_unreadable',
          reasonCode: 'landing_evidence_unobservable',
        };
      }
      out.landings.push(result);
      out.classCounts[result.landingClass] += 1;
      route(result, out);
    }
  }

  // Unresolved = failed (or undecided) and not qualified afterwards.
  const lastQualified = new Map<number, number>();
  for (const c of out.completions)
    if (c.taskId != null) lastQualified.set(c.taskId, c.at.getTime());
  const blocking = new Set<number>(out.pending.map((p) => p.taskId));
  for (const f of out.failures) {
    if (f.taskId != null && (lastQualified.get(f.taskId) ?? 0) < f.at.getTime())
      blocking.add(f.taskId);
  }
  out.blockingTaskIds = [...blocking].sort((a, b) => a - b);
  return out;
}
