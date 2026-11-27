/**
 * recheck-gate
 *
 * The implementer re-check of task 1572: a companion selected without a plan
 * (it carries a `parallel_recheck_pending` mark) is compared again, with its
 * planned files, against every task running in its theme and on its
 * repository right before its implementer starts. It proceeds when nothing
 * collides and is held (the runner re-queues it) when something does; the
 * reason goes to WorkflowTransition metadata and the cycle log once per change.
 * Not responsible for selection or for the open-PR overlap hold.
 */
import { createLogger } from '../../../../../config/logger';
import type { WorkflowAdvanceResult } from '../../../workflow-agent-executor';
import type { RoleTransition, WorkflowStatus } from '../../../workflow-types';
import type { ParallelVerdict, ThemeActiveSet } from '../parallel-types';
import type { PeerActiveTask } from '../repository-peers';
import { RECHECK_PASSED_CAUSE, clearRecheckHold, readRecheckMark } from './recheck-state';
import {
  collectRecheckOpponents,
  createModeAwareReader,
  dropNewerMarked,
  type RecheckOpponent,
} from './recheck-opponents';
import { holdImplementer as hold, noOpponent } from './recheck-hold';

const log = createLogger('workflow:parallel-recheck');

/** Collaborators, injectable for tests. Defaults resolve lazily (no static DB import). */
export interface RecheckGateDeps {
  getPrisma: () => Promise<unknown>;
  readActiveSet: (prisma: unknown, themeId: number) => Promise<ThemeActiveSet>;
  loadPeers: (prisma: unknown, themeId: number) => Promise<PeerActiveTask[]>;
  readMode: (prisma: unknown, taskId: number) => Promise<string | null>;
  readArtifact: (taskId: number, fileType: 'plan' | 'research') => Promise<string | null>;
  /** Judge the candidate against one opponent with the existing pair rules. */
  judge: (
    prisma: unknown,
    opponent: RecheckOpponent,
    candidateId: number,
    cwd: string | null,
    readPlan: (taskId: number) => Promise<string | null>,
  ) => Promise<ParallelVerdict>;
  now: () => number;
}

type Client = Parameters<typeof import('../parallel-filter').buildParallelFilter>[0];

const defaultDeps: RecheckGateDeps = {
  getPrisma: async () => (await import('../../../../../config')).prisma,
  readActiveSet: async (prisma, themeId) =>
    (await import('../theme-active-set')).readThemeActiveSet(prisma as Client, themeId),
  loadPeers: async (prisma, themeId) =>
    (await import('../repository-peers')).loadRepositoryPeerActiveTasks(prisma as Client, themeId),
  readMode: async (prisma, taskId) => {
    const row = await (prisma as Client).task.findUnique({
      where: { id: taskId },
      select: { workflowMode: true },
    });
    return row?.workflowMode ?? null;
  },
  readArtifact: async (taskId, fileType) =>
    (await import('../../../workflow-file-utils')).readWorkflowFile(taskId, fileType),
  judge: async (prisma, opponent, candidateId, cwd, readPlan) => {
    const { buildParallelFilter } = await import('../parallel-filter');
    // requirePlans on every side: this is the last check before files change,
    // so an opponent without a plan is waited on (ordering prevents cycles).
    const filter = buildParallelFilter(
      prisma as Client,
      [{ taskId: opponent.taskId, sameTheme: true }],
      cwd,
      { readPlan },
    );
    return filter({ id: candidateId, status: 'todo' });
  },
  now: () => Date.now(),
};

/** The slice of the resolved task the gate needs. */
export interface RecheckGateTask {
  themeId: number | null;
  theme: { workingDirectory: string | null } | null;
}

export type RecheckGateOutcome = { done: true; result: WorkflowAdvanceResult } | { done: false };

/**
 * Re-check a planless-selected companion right before its implementer.
 *
 * @param taskId - Task about to run its implementer / 実装に入るタスク
 * @param transition - Resolved role transition / 遷移
 * @param task - Theme and working directory / テーマと作業ディレクトリ
 * @param currentStatus - Status reported while held / 保留時のステータス
 * @param workflowMode - The task's workflow mode / ワークフローモード
 * @param deps - Test overrides / テスト用差し替え
 * @returns Early-return result while held, else continue / 保留中は早期終了
 */
export async function guardParallelRecheck(
  taskId: number,
  transition: RoleTransition,
  task: RecheckGateTask,
  currentStatus: WorkflowStatus,
  workflowMode: string | null,
  deps: Partial<RecheckGateDeps> = {},
): Promise<RecheckGateOutcome> {
  if (transition.role !== 'implementer') return { done: false };
  const d: RecheckGateDeps = { ...defaultDeps, ...deps };
  const prisma = await d.getPrisma();
  const ctx = { taskId, themeId: task.themeId, transition, currentStatus, prisma, now: d.now };

  let mark: Awaited<ReturnType<typeof readRecheckMark>>;
  try {
    mark = await readRecheckMark(prisma, taskId);
  } catch (err) {
    log.warn({ err, taskId }, '[parallel-recheck] mark read failed — holding');
    return hold(ctx, null, noOpponent('mark_read_failed', 'could not read the re-check mark'));
  }
  if (!mark.pending || mark.markAt == null || task.themeId == null) {
    clearRecheckHold(taskId);
    return { done: false };
  }
  const markAt = mark.markAt;
  const themeId = task.themeId;
  const set = await d
    .readActiveSet(prisma, themeId)
    .catch(() => ({ headTaskId: null, companions: [], raw: null, readable: false }));
  if (!set.readable) {
    return hold(ctx, markAt, noOpponent('active_set_unreadable', 'theme running set unreadable'));
  }
  const members = [set.headTaskId, ...set.companions.map((c) => c.taskId)];
  if (!members.includes(taskId)) {
    // NOTE: G1 — the slot was lost (auto-run stopped, selection undone,
    // addCompanion failed) while the mark is unconsumed. A self-driven advance
    // (plan auto-approve, resume-redispatch, post-restart) must not start the
    // implementer unchecked, so hold until auto-run selects the task again.
    return hold(ctx, markAt, noOpponent('not_enrolled', 'task holds no slot in its theme'));
  }

  const peers = await d.loadPeers(prisma, themeId).catch(() => [] as PeerActiveTask[]);
  const opponents = dropNewerMarked(
    { taskId, markAt },
    await collectRecheckOpponents(taskId, set, peers, (id) => readRecheckMark(prisma, id)),
  );
  const readPlan = createModeAwareReader(
    { readMode: (id) => d.readMode(prisma, id), readArtifact: d.readArtifact },
    { [taskId]: workflowMode },
  );
  const rules = await import('../parallel-safety-rules');
  const candFiles = rules.collectPlanFiles(await readPlan(taskId));
  if (rules.isEmptyPlanFileSet(candFiles)) {
    return hold(ctx, markAt, noOpponent('candidate_files_missing', 'no planned files to compare'));
  }

  const cwd = task.theme?.workingDirectory ?? null;
  for (const o of opponents) {
    const verdict = await d.judge(prisma, o, taskId, cwd, readPlan).catch(
      (err): ParallelVerdict => ({
        ok: false,
        reason: 'judge_failed',
        detail: err instanceof Error ? err.message : String(err),
      }),
    );
    if (verdict.ok) continue;
    const actFiles = rules.collectPlanFiles(await readPlan(o.taskId));
    const files =
      verdict.reason === 'file_overlap'
        ? rules.overlappingEntries(candFiles, actFiles)
        : verdict.reason === 'conflict_prone_file'
          ? [...new Set(rules.blockingConflictProneHits(candFiles, actFiles).map((h) => h.file))]
          : [];
    return hold(ctx, markAt, {
      opponentTaskId: o.taskId,
      reason: verdict.reason,
      detail: verdict.detail,
      files,
      // A lookup error is not a wait on the opponent; let the backstop see it.
      exempt: verdict.reason !== 'judge_failed',
    });
  }

  clearRecheckHold(taskId);
  const model = (prisma as { workflowTransition?: { create?: (a: unknown) => Promise<unknown> } })
    .workflowTransition;
  try {
    if (typeof model?.create !== 'function') throw new Error('workflowTransition.create missing');
    await model.create({
      data: {
        taskId,
        fromStatus: currentStatus,
        toStatus: currentStatus,
        actor: 'system',
        cause: RECHECK_PASSED_CAUSE,
        metadata: JSON.stringify({ comparedTaskIds: opponents.map((o) => o.taskId) }),
      },
    });
  } catch (err) {
    // Safe: the mark stays pending, so the next advance simply re-checks.
    log.warn({ err, taskId }, '[parallel-recheck] passed row write failed');
  }
  log.info(
    { taskId, compared: opponents.map((o) => o.taskId) },
    '[parallel-recheck] no overlap — implementer proceeds',
  );
  return { done: false };
}
