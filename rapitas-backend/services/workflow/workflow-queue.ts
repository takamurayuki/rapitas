/**
 * Workflow Queue Service
 *
 * Manages workflow task queuing with a hybrid in-memory queue + DB persistence approach.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { resolveTaskWorkflowState } from '../task/task-resolver';
import { narrowWorkflowStatus } from './workflow-types.guards.generated';
import { hasUsableProvider, isProviderOutageFailure } from './queue-provider-gate';
import { isNonRunnableTaskSkip } from './queue-skip-policy';

const log = createLogger('workflow-queue');

export interface QueueItem {
  id: number;
  taskId: number;
  orchestraSessionId: number | null;
  priority: number;
  status: string;
  currentPhase: string;
  dependencies: number[];
  retryCount: number;
  maxRetries: number;
  errorMessage: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * Whether a task has reached a terminal state that makes any queued work for it
 * stale. Shared by the dequeue-time guard and the reconciler's periodic sweep
 * so the two can never drift apart on what "terminal" means (concern #4924).
 * Requires POSITIVE terminal evidence — a null lookup can also be a transient
 * DB error and must not read as terminal.
 *
 * @param task - Minimal task state (or null when lookup failed). / タスク状態
 * @returns true when the task is done/cancelled/completed. / 終端なら true
 */
export function isTaskTerminalForQueue(
  task: { status?: string | null; workflowStatus?: string | null } | null,
): boolean {
  if (!task) return false;
  return (
    task.status === 'done' || task.status === 'cancelled' || task.workflowStatus === 'completed'
  );
}

export interface EnqueueOptions {
  taskId: number;
  priority?: number;
  dependencies?: number[];
  orchestraSessionId?: number;
  /** Set by the theme auto-run scheduler to scope concurrency and completion tracking. */
  themeId?: number;
}

export interface QueueState {
  queued: QueueItem[];
  running: QueueItem[];
  waitingApproval: QueueItem[];
  completed: QueueItem[];
  failed: QueueItem[];
  totalItems: number;
  maxConcurrency: number;
}

/**
 * Default executor concurrency. The WorkflowRunner dequeues up to this many
 * items AT ONCE. It must match the auto-run SELECTION gate
 * (AUTO_RUN_GLOBAL_MAX_CONCURRENCY, default 1): the theme scheduler only limits
 * how many themeId-tagged tasks it ENQUEUES, but any extra queued item (a
 * subtask, a self-repair re-queue, a themeId-less resume) would otherwise let
 * the runner start a 2nd/3rd agent while another task is mid-flight — the
 * "multiple agents launched before others finished" bug. Keep them aligned;
 * AIOrchestra still raises it per-session via setMaxConcurrency for intentional
 * parallel orchestration.
 */
const DEFAULT_MAX_CONCURRENCY = Math.max(
  1,
  Math.min(
    10,
    parseInt(
      process.env.WORKFLOW_RUNNER_MAX_CONCURRENCY ??
        process.env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY ??
        '1',
      10,
    ) || 1,
  ),
);

export class WorkflowQueueService {
  private static instance: WorkflowQueueService;
  private maxConcurrency = DEFAULT_MAX_CONCURRENCY;

  static getInstance(): WorkflowQueueService {
    if (!WorkflowQueueService.instance) {
      WorkflowQueueService.instance = new WorkflowQueueService();
    }
    return WorkflowQueueService.instance;
  }

  setMaxConcurrency(max: number): void {
    this.maxConcurrency = Math.max(1, Math.min(10, max));
  }

  getMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  /**
   * Enqueue a task.
   */
  async enqueue(options: EnqueueOptions): Promise<QueueItem> {
    const { taskId, priority = 50, dependencies = [], orchestraSessionId, themeId } = options;

    // Verify task exists
    const task = await resolveTaskWorkflowState(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Duplicate check (within same session)
    const existing = await prisma.workflowQueueItem.findFirst({
      where: {
        taskId,
        orchestraSessionId: orchestraSessionId ?? null,
        status: { in: ['queued', 'running', 'waiting_approval'] },
      },
    });
    if (existing) {
      throw new Error(`Task ${taskId} is already in the queue (status: ${existing.status})`);
    }

    const item = await prisma.workflowQueueItem.create({
      data: {
        taskId,
        orchestraSessionId: orchestraSessionId ?? null,
        themeId: themeId ?? null,
        priority,
        status: 'queued',
        currentPhase: narrowWorkflowStatus(task.workflowStatus),
        dependencies: JSON.stringify(dependencies),
      },
    });

    log.info(`[WorkflowQueue] Enqueued task ${taskId} with priority ${priority}`);
    return this.mapToQueueItem(item);
  }

  /**
   * Dequeue the next executable item (with dependency checks and race condition protection).
   */
  async dequeue(): Promise<QueueItem | null> {
    // Check current running item count
    const runningCount = await prisma.workflowQueueItem.count({
      where: { status: 'running' },
    });
    if (runningCount >= this.maxConcurrency) {
      return null;
    }

    // Every provider is cooling down (quota / rate limit): dispatching now
    // just burns a task's retries against an outage. Hold the queue instead —
    // the theme scheduler treats an empty dequeue as "idle but armed" and
    // resumes on its own once a cooldown expires. Fails open.
    if (!(await hasUsableProvider())) {
      log.info('[WorkflowQueue] All providers are in cooldown — holding the queue');
      return null;
    }

    // Get queued items sorted by priority
    const candidates = await prisma.workflowQueueItem.findMany({
      where: { status: 'queued' },
      orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
    });

    for (const candidate of candidates) {
      try {
        const deps = JSON.parse(candidate.dependencies || '[]') as number[];

        // Check if all dependency tasks are completed (or cancelled)
        if (deps.length > 0) {
          const incompleteDeps = await prisma.workflowQueueItem.count({
            where: {
              taskId: { in: deps },
              orchestraSessionId: candidate.orchestraSessionId,
              status: { notIn: ['completed', 'cancelled'] },
            },
          });
          if (incompleteDeps > 0) continue;
        }

        // Strict sequential execution for sibling subtasks (same parent): run
        // ONE at a time, in creation (id) order. Plan-split subtasks share the
        // parent's git worktree and often build on each other, so running them
        // concurrently risks conflicts and lower quality — hold a candidate back
        // while any sibling is active, or while an earlier-created sibling is
        // still pending. Non-subtasks (no parentId) are unaffected.
        const candidateTask = await resolveTaskWorkflowState(candidate.taskId);

        // Terminal-task guard: a queue item can outlive its task (a
        // completion-era re-dispatch raced the task finishing — task 537 left
        // one 'queued' forever, pinning queueDepth at 1 and dispatching a
        // phantom implementer that failed with "no code changes"). Cancel the
        // stale item instead of dispatching a phase for finished work.
        // Requires POSITIVE terminal evidence — a null lookup can also be a
        // transient DB error and must not destroy a valid queue item.
        if (isTaskTerminalForQueue(candidateTask)) {
          await prisma.workflowQueueItem
            .update({
              where: { id: candidate.id },
              data: {
                status: 'cancelled',
                completedAt: new Date(),
                errorMessage: 'タスクは既に終端状態のため、残留キュー項目を自動キャンセルしました',
              },
            })
            .catch(() => {});
          log.info(
            `[WorkflowQueue] Cancelled stale queue item ${candidate.id} (task ${candidate.taskId} already terminal)`,
          );
          continue;
        }
        if (candidateTask?.parentId != null) {
          const siblings = await prisma.task.findMany({
            where: { parentId: candidateTask.parentId, id: { not: candidate.taskId } },
            select: { id: true },
          });
          const siblingIds = siblings.map((s) => s.id);
          if (siblingIds.length > 0) {
            const activeSibling = await prisma.workflowQueueItem.count({
              where: {
                taskId: { in: siblingIds },
                orchestraSessionId: candidate.orchestraSessionId,
                status: { in: ['running', 'waiting_approval'] },
              },
            });
            if (activeSibling > 0) continue; // a sibling is already running

            const earlierIds = siblingIds.filter((id) => id < candidate.taskId);
            if (earlierIds.length > 0) {
              const earlierPending = await prisma.workflowQueueItem.count({
                where: {
                  taskId: { in: earlierIds },
                  orchestraSessionId: candidate.orchestraSessionId,
                  status: { in: ['queued', 'running', 'waiting_approval'] },
                },
              });
              if (earlierPending > 0) continue; // earlier-created sibling goes first
            }
          }
        }

        // Start execution (transaction prevents race conditions)
        const updated = await prisma.$transaction(async (tx) => {
          // Re-check status (another worker may have acquired it)
          const current = await tx.workflowQueueItem.findUnique({
            where: { id: candidate.id },
          });
          if (!current || current.status !== 'queued') {
            return null; // Already acquired by another worker
          }

          // Re-check concurrency limit
          const currentRunning = await tx.workflowQueueItem.count({
            where: { status: 'running' },
          });
          if (currentRunning >= this.maxConcurrency) {
            return null; // Concurrency limit reached
          }

          return tx.workflowQueueItem.update({
            where: { id: candidate.id },
            data: { status: 'running', startedAt: new Date() },
          });
        });

        if (updated) {
          log.info(`[WorkflowQueue] Dequeued task ${candidate.taskId} (item ${candidate.id})`);
          return this.mapToQueueItem(updated);
        }
        // Failed due to race condition, try next candidate
      } catch (error) {
        log.warn({ err: error }, `[WorkflowQueue] Failed to dequeue candidate ${candidate.id}`);
        continue; // Try next candidate
      }
    }

    return null;
  }

  /**
   * Update item status.
   */
  async updateStatus(
    itemId: number,
    status: string,
    extra?: { currentPhase?: string; errorMessage?: string; result?: string },
  ): Promise<QueueItem> {
    const data: Record<string, unknown> = { status };
    if (extra?.currentPhase) data.currentPhase = extra.currentPhase;
    if (extra?.errorMessage) data.errorMessage = extra.errorMessage;
    if (extra?.result) data.result = extra.result;
    if (status === 'completed' || status === 'failed') {
      data.completedAt = new Date();
    }

    const updated = await prisma.workflowQueueItem.update({
      where: { id: itemId },
      data,
    });
    return this.mapToQueueItem(updated);
  }

  /**
   * Check if retry is possible and execute retry.
   */
  async retryIfPossible(itemId: number, reason?: string): Promise<boolean> {
    const item = await prisma.workflowQueueItem.findUnique({ where: { id: itemId } });
    if (!item) return false;

    // Do NOT resurrect an item that was stopped/cancelled externally (e.g. the
    // user stopped auto-run, which cancels the queue item AND kills the agent).
    // The kill makes the phase fail, and without this guard the failure path
    // re-queued the cancelled item back to 'queued' → it was re-dequeued and a
    // NEW agent spawned, so "stop" never actually stopped. Manual stop is not
    // driven by this runner loop, which is why only auto-run was affected.
    if (item.status === 'cancelled' || item.status === 'completed') {
      log.info(
        `[WorkflowQueue] Skipping retry for item ${itemId} — already ${item.status} (external stop)`,
      );
      return false;
    }

    // The task cannot run at all right now (blocked / awaiting an answer /
    // workflow disabled). Retrying re-asks the same question three times and
    // overwrites the REAL reason the task stopped with the skip message, which
    // is what made these tasks impossible to diagnose. Cancel the item and keep
    // whatever reason is already recorded; the scheduler re-enqueues the task
    // once it becomes runnable again.
    if (isNonRunnableTaskSkip(reason)) {
      await prisma.workflowQueueItem.update({
        where: { id: itemId },
        data: { status: 'cancelled', completedAt: new Date() },
      });
      log.info(
        { itemId, taskId: item.taskId, reason },
        '[WorkflowQueue] Task is not runnable — cancelled without consuming a retry',
      );
      return false;
    }

    // A provider outage says nothing about this task, so it must not spend one
    // of its finite retries. Re-queue at the same retryCount; the dequeue gate
    // above keeps this from becoming a hot loop while the provider cools.
    if (await isProviderOutageFailure(reason)) {
      await prisma.workflowQueueItem.update({
        where: { id: itemId },
        data: { status: 'queued', startedAt: null, errorMessage: reason ?? null },
      });
      log.warn(
        { itemId, retryCount: item.retryCount, reason },
        '[WorkflowQueue] Provider outage — re-queued without consuming a retry',
      );
      return true;
    }

    if (item.retryCount >= item.maxRetries) {
      // Preserve the underlying failure reason instead of masking every
      // failure behind the generic "Max retries exceeded" message.
      await this.updateStatus(itemId, 'failed', {
        errorMessage: reason
          ? `Max retries (${item.maxRetries}) exceeded — last error: ${reason}`
          : `Max retries (${item.maxRetries}) exceeded`,
      });
      return false;
    }

    await prisma.workflowQueueItem.update({
      where: { id: itemId },
      data: {
        status: 'queued',
        retryCount: item.retryCount + 1,
        startedAt: null,
        // Keep the latest failure reason visible while queued for the retry.
        errorMessage: reason ?? null,
      },
    });
    log.info(`[WorkflowQueue] Retry ${item.retryCount + 1}/${item.maxRetries} for item ${itemId}`);
    return true;
  }

  /**
   * Cancel a queue item.
   */
  async cancel(itemId: number): Promise<QueueItem> {
    return this.updateStatus(itemId, 'cancelled');
  }

  /**
   * Update priority.
   */
  async updatePriority(itemId: number, priority: number): Promise<QueueItem> {
    const updated = await prisma.workflowQueueItem.update({
      where: { id: itemId },
      data: { priority: Math.max(0, Math.min(100, priority)) },
    });
    return this.mapToQueueItem(updated);
  }

  /**
   * Get the current queue state.
   */
  async getQueueState(sessionId?: number): Promise<QueueState> {
    const where = sessionId ? { orchestraSessionId: sessionId } : {};

    const items = await prisma.workflowQueueItem.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
    });

    const mapped = items.map((i) => this.mapToQueueItem(i));

    return {
      queued: mapped.filter((i) => i.status === 'queued'),
      running: mapped.filter((i) => i.status === 'running'),
      waitingApproval: mapped.filter((i) => i.status === 'waiting_approval'),
      completed: mapped.filter((i) => i.status === 'completed'),
      failed: mapped.filter((i) => i.status === 'failed'),
      totalItems: mapped.length,
      maxConcurrency: this.maxConcurrency,
    };
  }

  /**
   * Get items within a session.
   */
  async getSessionItems(sessionId: number): Promise<QueueItem[]> {
    const items = await prisma.workflowQueueItem.findMany({
      where: { orchestraSessionId: sessionId },
      orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
    });
    return items.map((i) => this.mapToQueueItem(i));
  }

  /**
   * On server restart, return running items back to queued status.
   */
  async recoverStaleItems(): Promise<number> {
    const result = await prisma.workflowQueueItem.updateMany({
      where: { status: 'running' },
      data: { status: 'queued', startedAt: null },
    });
    if (result.count > 0) {
      log.info(`[WorkflowQueue] Recovered ${result.count} stale running items to queued`);
    }
    return result.count;
  }

  /**
   * Find a queue item by task ID.
   */
  async findByTaskId(taskId: number, sessionId?: number): Promise<QueueItem | null> {
    const item = await prisma.workflowQueueItem.findFirst({
      where: {
        taskId,
        ...(sessionId ? { orchestraSessionId: sessionId } : {}),
        status: { in: ['queued', 'running', 'waiting_approval'] },
      },
    });
    return item ? this.mapToQueueItem(item) : null;
  }

  private mapToQueueItem(item: {
    id: number;
    taskId: number;
    orchestraSessionId: number | null;
    priority: number;
    status: string;
    currentPhase: string;
    dependencies: string;
    retryCount: number;
    maxRetries: number;
    errorMessage: string | null;
    queuedAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  }): QueueItem {
    return {
      id: item.id,
      taskId: item.taskId,
      orchestraSessionId: item.orchestraSessionId,
      priority: item.priority,
      status: item.status,
      currentPhase: item.currentPhase,
      dependencies: JSON.parse(item.dependencies || '[]'),
      retryCount: item.retryCount,
      maxRetries: item.maxRetries,
      errorMessage: item.errorMessage,
      queuedAt: item.queuedAt,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
    };
  }
}
