/**
 * companion-selection
 *
 * Builds the parallel-safety filter and selects a theme's 2nd+ task (task
 * 1552). A candidate is taken only when every running task of the theme — and
 * of the other themes on the same repository — passes judgePair against it.
 * Not responsible for advancing running tasks or releasing slots.
 */
import type { PrismaClient } from '../../../../generated/prisma-postgres';
import { createLogger } from '../../../../config/logger';
import { logCycleEvent } from '../../../observability';
import { WorkflowQueueService } from '../../workflow-queue';
import {
  resolveAutoRunMaxConcurrency,
  resolveAutoRunMaxConcurrencyPerTheme,
} from '../auto-run-concurrency';
import { selectNextTask } from '../auto-run-selection';
import { getOpenAutoPrsForRepository } from '../open-pr-files-cache';
import { buildScopeOverlapContext } from '../auto-run-advance-scope';
import { loadRepositoryPeerActiveTasks } from './repository-peers';
import {
  activeTaskIds,
  addCompanion,
  loadThemeActiveSet,
  releaseThemeSlot,
  readThemeActiveSet,
} from './theme-active-set';
import type { ParallelRejection } from './parallel-types';
import {
  buildParallelFilter,
  logParallelRejections,
  type Opponent,
  type ParallelFilterDeps,
} from './parallel-filter';

import { countGlobalActiveSlots } from './global-active-slots';
import { collectPlanFiles, isEmptyPlanFileSet } from './parallel-safety-rules';
import { isPlanlessCandidate, writePendingMark } from './recheck/recheck-state';

const log = createLogger('companion-selection');

// The filter lives in parallel-filter.ts (file-size limit); re-exported here.
export {
  buildParallelFilter,
  logParallelRejections,
  type Opponent,
  type ParallelFilterDeps,
} from './parallel-filter';

/** Collaborators for {@link selectCompanionTask}, injectable for tests. */
export interface CompanionSelectionDeps extends Partial<ParallelFilterDeps> {
  enqueue?: (item: { taskId: number; themeId: number; priority: number }) => Promise<unknown>;
  now?: () => number;
  /** Writes the re-check mark of a planless companion; throws on failure (task 1572). */
  writeRecheckMark?: (input: {
    taskId: number;
    themeId: number;
    workflowStatus: string | null;
  }) => Promise<void>;
}

/** Why no companion was added (or the task that was). */
export type CompanionSelectionResult =
  | { selected: number }
  | {
      selected: null;
      reason:
        | 'per_theme_limit'
        | 'empty'
        | 'theme_full'
        | 'concurrency_limit'
        | 'companion_write_failed'
        | 'enqueue_failed'
        | 'recheck_mark_failed'
        | string;
      rejected?: ParallelRejection[];
    };

/**
 * Select and enqueue one companion for a running theme that has a free
 * per-theme slot.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme / テーマID
 * @param order - Selection order / 選定順
 * @param deps - Test overrides / テスト用差し替え
 * @returns Selected task, or why none / 選定結果
 */
export async function selectCompanionTask(
  prisma: PrismaClient,
  themeId: number,
  order: 'priority' | 'created',
  deps: CompanionSelectionDeps = {},
): Promise<CompanionSelectionResult> {
  const perTheme = await resolveAutoRunMaxConcurrencyPerTheme(prisma);
  if (perTheme.effective < 2) return { selected: null, reason: 'per_theme_limit' };
  const set = await loadThemeActiveSet(prisma, themeId);
  const ids = activeTaskIds(set);
  if (ids.length === 0) return { selected: null, reason: 'empty' };
  if (!set.readable || ids.length >= perTheme.effective) {
    return { selected: null, reason: 'theme_full' };
  }

  // Queue rows lag a head between phases, slot rows lag a just-enqueued item:
  // the larger of the two never under-counts.
  const globalActive = await countGlobalActiveSlots(prisma);
  const { limit } = await resolveAutoRunMaxConcurrency(prisma);
  if (globalActive >= limit) return { selected: null, reason: 'concurrency_limit' };

  const theme = await prisma.theme
    .findUnique({ where: { id: themeId }, select: { workingDirectory: true } })
    .catch(() => null);
  const peers = await loadRepositoryPeerActiveTasks(prisma, themeId);
  const opponents: Opponent[] = [
    ...ids.map((taskId) => ({ taskId, sameTheme: true })),
    ...peers
      .filter((p) => !ids.includes(p.taskId))
      .map((p) => ({ taskId: p.taskId, sameTheme: false })),
  ];

  const skipRows = await prisma.task
    .findMany({
      where: {
        themeId,
        OR: [
          { status: 'blocked' },
          // A re-run needs the head path's stale-terminal reset; leave it to the head.
          { workflowStatus: { in: ['verify_done', 'completed'] } },
        ],
      },
      select: { id: true },
    })
    .catch(() => [] as Array<{ id: number }>);
  const halted = await (
    prisma.task as unknown as {
      findMany: (args: unknown) => Promise<Array<{ id: number }>>;
    }
  )
    .findMany({ where: { themeId, haltReason: { not: null } }, select: { id: true } })
    .catch(() => [] as Array<{ id: number }>);
  const skipIds = [
    ...new Set([
      ...ids,
      ...peers.map((p) => p.taskId),
      ...skipRows.map((t) => t.id),
      ...halted.map((t) => t.id),
    ]),
  ];

  const openPrs = await getOpenAutoPrsForRepository(prisma, themeId).catch(() => []);
  const scopeOverlap = await buildScopeOverlapContext(prisma, themeId, openPrs).catch(
    () => undefined,
  );
  const filter = buildParallelFilter(prisma, opponents, theme?.workingDirectory ?? null, deps);
  const result = await selectNextTask(
    prisma,
    themeId,
    order,
    skipIds,
    globalActive,
    null,
    scopeOverlap,
    filter,
  );
  logParallelRejections(themeId, result.rejected, 'companion');
  if (!result.found) return { selected: null, reason: result.reason, rejected: result.rejected };

  const taskId = result.taskId;
  const now = (deps.now ?? Date.now)();
  // Task 1572: the mark goes BEFORE the slot, so no companion ever holds a slot
  // without the implementer re-check it was admitted on.
  if (!(await markPlanlessCompanion(prisma, themeId, taskId, deps))) {
    return { selected: null, reason: 'recheck_mark_failed' };
  }
  if (!(await addCompanion(prisma, themeId, taskId, now))) {
    return { selected: null, reason: 'companion_write_failed' };
  }
  const enqueue = deps.enqueue ?? ((item) => WorkflowQueueService.getInstance().enqueue(item));
  try {
    await enqueue({ taskId, themeId, priority: 50 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('already in the queue')) {
      // Undo the slot: a companion with no queue item would hold it for nothing.
      await releaseThemeSlot(prisma, themeId, taskId, 'released');
      log.error({ err, themeId, taskId }, 'companion enqueue failed — slot released');
      return { selected: null, reason: 'enqueue_failed' };
    }
  }
  // 投入と停止が競合したら、停止処理より遅れて作られたキューも取り消す。
  const latest = await prisma.themeAutoRun.findFirst({ where: { themeId } });
  if (
    latest?.status !== 'running' ||
    !activeTaskIds(await readThemeActiveSet(prisma, themeId)).includes(taskId)
  ) {
    await prisma.workflowQueueItem.updateMany({
      where: { themeId, taskId, status: { in: ['queued', 'running', 'waiting_approval'] } },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        errorMessage: '同伴選定中に停止要求を受けた',
      },
    });
    const { stopTaskTreeAgents } = await import('../../../agents/stop-task-agents');
    const stopped = await stopTaskTreeAgents(taskId);
    const { settleStoppedTasks } = await import('../../../agents/settle-stopped-tasks');
    await settleStoppedTasks(prisma, stopped.executionIds);
    await releaseThemeSlot(prisma, themeId, taskId, 'released');
    log.info(
      { themeId, taskId, status: latest?.status },
      '停止要求により投入を取り消し、プロセスを停止した',
    );
    return { selected: null, reason: 'theme_stopped' };
  }
  log.info({ themeId, taskId, running: ids }, 'companion task selected and enqueued');
  logCycleEvent('task.enqueued', {
    theme: themeId,
    task: taskId,
    role: 'companion',
    running: ids.length,
    msg: 'companion task selected and enqueued (parallel within the theme)',
  });
  return { selected: taskId };
}

/**
 * Write the re-check mark when the selected companion has no plan yet.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme / テーマID
 * @param taskId - Selected task / 選定したタスク
 * @param deps - Test overrides / テスト用差し替え
 * @returns False when a needed mark could not be written / 必要な印を書けなければ false
 */
async function markPlanlessCompanion(
  prisma: PrismaClient,
  themeId: number,
  taskId: number,
  deps: CompanionSelectionDeps,
): Promise<boolean> {
  try {
    const readPlan =
      deps.readPlan ??
      (async (id: number) => {
        const { readWorkflowFile } = await import('../../workflow-file-utils');
        return readWorkflowFile(id, 'plan');
      });
    const [row, plan] = await Promise.all([
      prisma.task.findUnique({ where: { id: taskId }, select: { workflowStatus: true } }),
      readPlan(taskId).catch(() => null),
    ]);
    const workflowStatus = row?.workflowStatus ?? null;
    if (!isPlanlessCandidate(workflowStatus, !isEmptyPlanFileSet(collectPlanFiles(plan)))) {
      return true;
    }
    const write = deps.writeRecheckMark ?? ((input) => writePendingMark(prisma, input));
    await write({ taskId, themeId, workflowStatus });
    return true;
  } catch (err) {
    log.error({ err, themeId, taskId }, 're-check mark write failed — companion not added');
    return false;
  }
}
