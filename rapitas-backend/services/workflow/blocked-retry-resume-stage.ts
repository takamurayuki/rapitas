/**
 * blocked-retry-resume-stage
 *
 * Decides which workflow stage a blocked task's auto-retry resumes from, and
 * gathers the facts that decision needs. It does NOT write any task state —
 * the writes stay in blocked-retry-dispatch.
 *
 * Why: the retry used to reset every blocked task to draft, which threw away a
 * PR waiting for its merge (task 1540) and implementations in progress (tasks
 * 1542 / 1551). Only a task with nothing to lose should restart from draft.
 */
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import type { PrismaClient } from '../../generated/prisma-postgres';

/** Where the retry resumes. */
export type ResumeKind = 'keep_stage' | 'merge_wait' | 'complete' | 'leave' | 'draft';

/** Machine-readable reason stored in `WorkflowTransition.metadata.resumeReason`. */
export type ResumeReason =
  | 'stage_kept_with_work'
  | 'merge_wait_open_pr'
  | 'completed_merged_pr'
  | 'draft_no_work'
  | 'draft_research_stage'
  | 'draft_pr_unconfirmed'
  | 'left_blocked_pr_unconfirmed'
  | 'left_blocked_stage_unknown'
  | 'left_blocked_work_unknown'
  | 'left_blocked_stop_guard'
  | 'left_blocked_cause_not_allowed'
  | 'stage_kept_verify_as_in_progress';

/** Observed facts about a blocked task. */
export interface ResumeFacts {
  /** Stage the task was in when it blocked (workflowStatus survives the block). */
  stage: string | null;
  /** Cause of the transition INTO blocked; null when it could not be read. */
  blockedCause?: string | null;
  /** Where `stage` came from (metadata `stageSource`); `unknown` when no source gave a stage. */
  stageSource?: 'blocked_transition' | 'history' | 'workflow_status' | 'unknown';
  /** True when work facts (task row / PR lookup) could not be read: absence is unproven. */
  workUnknown?: boolean;
  /** True when the task's working directory exists on disk. */
  dirExists: boolean;
  /** True when the task has a PR on record (number or linked row). */
  hasPr: boolean;
  /** `GitHubPullRequest.state` of the task's linked PR; null when unknown. */
  prState: string | null;
  /** Commits not yet pushed from the working directory; null when unmeasurable. */
  unpushedCommits: number | null;
}

/** The decision. */
export interface ResumeDecision {
  kind: ResumeKind;
  /** Stage written by the retry (`workflowStatus`); null for `complete`. */
  stage: string | null;
  reason: ResumeReason;
}

const WORK_STAGES = new Set(['plan_approved', 'in_progress']);
const INVESTIGATION_STAGES = new Set(['draft', 'research_done']);
/**
 * Causes of the transition into `blocked` whose task may be resumed WITHOUT a human look: the
 * work itself is sound and only time or process loss stopped it. Everything else (verification
 * holds, non-convergence, security / protected-path / diff-review holds, operator stops such as
 * auto_run_stop_revert / auto_run_excluded, plan or question budgets, unknown causes) stays
 * blocked: an automatic retry would repeat the same rejection or overrule a person's decision.
 */
export const RESUMABLE_BLOCK_CAUSES: readonly string[] = [
  // Whole-task time ceiling fired; the work was not judged bad (auto-run-hang-backstop-transition.ts).
  'auto_run_hang_backstop',
  // The orphan re-queue budget ran out because processes were lost (blocked-task-policy.ts).
  'orphan_requeue_exhausted',
];

/**
 * Whether a blocked-transition cause is on the resumable allow-list.
 *
 * @param cause - Cause read from the transition into blocked, or null. / blockedに入った遷移のcause
 * @returns True only for an allow-listed cause; null / unknown → false. / 許可リストに入る場合のみtrue
 */
export function isResumableBlockCause(cause: string | null | undefined): boolean {
  return cause != null && RESUMABLE_BLOCK_CAUSES.includes(cause);
}

/** Workflow stages a restored `fromStatus` may be trusted as (Task.status words are not). */
const KNOWN_STAGES = new Set([
  ...WORK_STAGES,
  ...INVESTIGATION_STAGES,
  'plan_created',
  'verify_done',
]);

/**
 * Pure decision table: where should this blocked task resume?
 *
 * @param facts - Observed facts. / 観測された事実
 * @returns The resume decision. / 再開先の決定
 */
export function decideResumeStage(facts: ResumeFacts): ResumeDecision {
  const stage = facts.stage;
  // A recorded PR state implies a PR exists even when the caller did not set hasPr.
  const hasPr = facts.hasPr || facts.prState != null;
  const state = facts.prState?.toLowerCase() ?? null;
  const draft = (reason: ResumeReason): ResumeDecision => ({
    kind: 'draft',
    stage: 'draft',
    reason,
  });

  const noWork = !facts.dirExists && !hasPr;
  // An unreadable work fact is not an absent one: never discard on a failed read.
  if (noWork && facts.workUnknown) {
    return { kind: 'leave', stage: null, reason: 'left_blocked_work_unknown' };
  }
  // 調査段階でも、読取失敗を作業なしと見なして draft に戻してはいけない。
  if (stage === 'draft' || stage === 'research_done') return draft('draft_research_stage');
  if (stage === null) {
    // The stage could not be determined. Nothing to lose → draft; otherwise leave it
    // blocked rather than discard a worktree / PR on a guess.
    return noWork
      ? draft('draft_no_work')
      : { kind: 'leave', stage: null, reason: 'left_blocked_stage_unknown' };
  }
  if (noWork) return draft(stage === 'verify_done' ? 'draft_pr_unconfirmed' : 'draft_no_work');
  if (stage === 'verify_done') {
    // NOTE: only a recorded `merged` completes the task.
    if (state === 'open') return { kind: 'merge_wait', stage, reason: 'merge_wait_open_pr' };
    if (state === 'merged') return { kind: 'complete', stage: null, reason: 'completed_merged_pr' };
    // NOTE: `todo` + verify_done is reset to draft by selection, so a kept worktree resumes as
    // in_progress (the verifier simply runs again). Without a worktree the PR is closed or
    // unreadable: leave it blocked for the operator rather than discard or complete it.
    if (facts.dirExists) {
      return {
        kind: 'keep_stage',
        stage: 'in_progress',
        reason: 'stage_kept_verify_as_in_progress',
      };
    }
    return { kind: 'leave', stage: null, reason: 'left_blocked_pr_unconfirmed' };
  }
  if (stage === 'plan_created' || WORK_STAGES.has(stage)) {
    return { kind: 'keep_stage', stage, reason: 'stage_kept_with_work' };
  }
  // An unrecognised stage with work present: leave it for the operator.
  return { kind: 'leave', stage: null, reason: 'left_blocked_stage_unknown' };
}

/** Counts commits ahead of the upstream; null on any failure (no upstream, no git). */
function countUnpushed(dir: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', dir, 'rev-list', '--count', '@{upstream}..HEAD'],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        const n = Number.parseInt(String(stdout).trim(), 10);
        resolve(err || !Number.isFinite(n) ? null : n);
      },
    );
  });
}

/** Test seams for fact gathering. */
export interface ResumeFactDeps {
  dirExists?: (dir: string) => boolean;
  unpushed?: (dir: string) => Promise<number | null>;
}

/**
 * Read the facts the decision needs. Never throws: a failed read degrades to
 * the conservative value (no work / unknown PR state) so the caller falls back
 * to the pre-existing draft reset.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param task - Blocked task (id and current workflowStatus). / blockedタスク
 * @param deps - Optional overrides for tests. / テスト用差し替え
 * @returns Observed facts. / 観測結果
 */
export async function loadResumeFacts(
  prisma: PrismaClient,
  task: { id: number; workflowStatus: string | null },
  deps: ResumeFactDeps = {},
): Promise<ResumeFacts> {
  const facts: ResumeFacts = {
    stage: null,
    dirExists: false,
    hasPr: false,
    prState: null,
    unpushedCommits: null,
  };
  let prNumber: number | null = null;
  facts.stage = null;
  facts.stageSource = 'unknown';
  try {
    // 1) The transition INTO blocked remembers the stage the task was in.
    const into = await prisma.workflowTransition.findFirst({
      where: { taskId: task.id, toStatus: 'blocked' },
      orderBy: { createdAt: 'desc' },
      select: { fromStatus: true, createdAt: true, cause: true },
    });
    facts.blockedCause = into?.cause ?? null;
    // fromStatus falls back to Task.status ('in-progress', 'todo') when no workflowStatus existed;
    // such a word is not a stage, so it is ignored.
    if (into?.fromStatus && KNOWN_STAGES.has(into.fromStatus)) {
      facts.stage = into.fromStatus;
      facts.stageSource = 'blocked_transition';
    } else {
      // 2) The last real stage the history entered.
      const entered = await prisma.workflowTransition.findFirst({
        // Only stages entered BEFORE the block count: a later draft is a retry artefact.
        where: {
          taskId: task.id,
          toStatus: { in: [...KNOWN_STAGES] },
          ...(into?.createdAt ? { createdAt: { lt: into.createdAt } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        select: { toStatus: true },
      });
      if (entered?.toStatus && KNOWN_STAGES.has(entered.toStatus)) {
        facts.stage = entered.toStatus;
        facts.stageSource = 'history';
      }
    }
  } catch {
    // history unreadable: fall through to the current workflowStatus
  }
  // 3) The current workflowStatus.
  if (facts.stage === null && task.workflowStatus && KNOWN_STAGES.has(task.workflowStatus)) {
    facts.stage = task.workflowStatus;
    facts.stageSource = 'workflow_status';
  }
  let dir: string | null = null;
  let rowRead = false;
  try {
    const row = await prisma.task.findUnique({
      where: { id: task.id },
      select: { workingDirectory: true, githubPrId: true },
    });
    dir = row?.workingDirectory?.trim() || null;
    facts.dirExists = dir ? (deps.dirExists ?? existsSync)(dir) : false;
    prNumber = row?.githubPrId ?? null;
    // Kept BEFORE the PR lookup: a failing lookup must not make a known PR look absent.
    facts.hasPr = prNumber != null;
    rowRead = true;
  } catch {
    facts.workUnknown = true; // the row could not be read: absence of work is unproven
  }
  // Without the task row the PR cannot be scoped (githubPrId unknown), so its state stays unknown.
  try {
    if (!rowRead) throw new Error('task row unavailable');
    // NOTE: Task.githubPrId is the PR NUMBER, not GitHubPullRequest.id. When it is set the
    // state is read from THAT PR (a task may link several, and an older merged one must not
    // decide for the current open one); no match means the state is unknown, never another PR's.
    const pr = await prisma.gitHubPullRequest.findFirst({
      where: { linkedTaskId: task.id, ...(prNumber != null ? { prNumber } : {}) },
      orderBy: { updatedAt: 'desc' },
      select: { state: true },
    });
    facts.prState = pr?.state ?? null;
    facts.hasPr = facts.hasPr || pr != null;
  } catch {
    // PR state unknown (null); hasPr keeps what the task row proved
    if (!facts.hasPr) facts.workUnknown = true;
  }
  // NOTE: Task.workingDirectory is often empty; the worktree path lives on the task's
  // AgentSession (task 1549 lost two commits to a draft reset on 2026-11-27).
  if (!facts.dirExists) {
    try {
      const s = await prisma.agentSession.findFirst({
        where: { config: { taskId: task.id }, worktreePath: { not: null } },
        orderBy: { id: 'desc' },
        select: { worktreePath: true },
      });
      const p = s?.worktreePath?.trim();
      if (p && (deps.dirExists ?? existsSync)(p)) [dir, facts.dirExists] = [p, true];
    } catch {
      facts.workUnknown = true; // the session row could not be read: absence is unproven
    }
  }
  if (dir && facts.dirExists) {
    facts.unpushedCommits = await (deps.unpushed ?? countUnpushed)(dir).catch(() => null);
  }
  return facts;
}
