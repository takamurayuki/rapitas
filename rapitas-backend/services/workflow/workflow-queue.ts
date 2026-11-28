/**
 * Workflow Queue Service
 *
 * Manages workflow task queuing with a hybrid in-memory queue + DB persistence approach.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { resolveTaskWorkflowState } from '../task/task-resolver';
import { narrowWorkflowStatus } from './workflow-types.guards.generated';
import { hasUsableProvider } from './queue-provider-gate';
import { retryQueueItem } from './queue/queue-retry';
import { isCountedAsCompleted } from './awaiting-ci';
import { tryDequeueCandidate } from './queue-dequeue-candidate';
import { mapToQueueItem } from './queue-item-mapper';
import { isOverlapHeld } from './workflow-orchestrator-overlap-guard';
import { logCycleEvent } from '../observability';
import type { QueueItem, EnqueueOptions, QueueState } from './workflow-queue.types';

export type { QueueItem, EnqueueOptions, QueueState } from './workflow-queue.types';
export { isTaskTerminalForQueue } from './queue-terminal-task-guard';

const log = createLogger('workflow-queue');

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
  // NOTE: kept apart from maxConcurrency (task 1543) — AIOrchestra writes that
  // field per session via setMaxConcurrency, and sharing it would let either
  // writer silently undo the other. The runner uses the larger of the two.
  private autoRunConcurrency = 1;

  static getInstance(): WorkflowQueueService {
    if (!WorkflowQueueService.instance) {
      WorkflowQueueService.instance = new WorkflowQueueService();
    }
    return WorkflowQueueService.instance;
  }

  setMaxConcurrency(max: number): void {
    this.maxConcurrency = Math.max(1, Math.min(10, max));
  }

  /**
   * Follow the auto-run concurrency setting, re-synced by the theme scheduler
   * every tick so a selected 2nd theme is not left queued behind a cap of 1.
   *
   * @param max - Resolved auto-run limit / 解決済みの自動実行の同時実行数
   */
  setAutoRunConcurrency(max: number): void {
    this.autoRunConcurrency = Math.max(1, Math.min(10, Math.floor(max) || 1));
  }

  getMaxConcurrency(): number {
    return Math.max(this.maxConcurrency, this.autoRunConcurrency);
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
    return mapToQueueItem(item);
  }

  /**
   * Dequeue the next executable item (with dependency checks and race condition protection).
   */
  async dequeue(): Promise<QueueItem | null> {
    // Check current running item count
    const runningCount = await prisma.workflowQueueItem.count({
      where: { status: 'running' },
    });
    if (runningCount >= this.getMaxConcurrency()) {
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
        const result = await tryDequeueCandidate(candidate, this.getMaxConcurrency());
        if (result) return result;
        // Not dispatchable (dependency wait / vanished / terminal / sibling
        // serialization / lost the acquire race) — try the next candidate.
      } catch (error) {
        log.warn({ err: error }, `[WorkflowQueue] Failed to dequeue candidate ${candidate.id}`);
        // Overlap-held candidates (task 954) rely on being re-evaluated every
        // poll; an exception here drops them from this pass with no other
        // trace, so cycle-log gets an explicit record when that happens.
        if (isOverlapHeld(candidate.taskId)) {
          logCycleEvent('task.dequeue_skipped', {
            task: candidate.taskId,
            reason: 'candidate_error',
            error: String(error),
            msg: 'overlap-held candidate dropped this dequeue pass by an exception',
          });
        }
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
    // 'cancelled' completes the item just like 'completed'/'failed' — needed
    // so the vanished-task cancellation path (queue-dequeue-candidate.ts) and
    // the terminal-task guard both leave a completedAt that downstream terminal-
    // item lookups (e.g. auto-run-advance-active.ts, ordered by completedAt desc)
    // can find and order correctly.
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      data.completedAt = new Date();
    }

    const updated = await prisma.workflowQueueItem.update({
      where: { id: itemId },
      data,
    });
    return mapToQueueItem(updated);
  }

  /**
   * Check if retry is possible and execute retry.
   */
  async retryIfPossible(itemId: number, reason?: string): Promise<boolean> {
    return retryQueueItem(itemId, reason, (errorMessage) =>
      this.updateStatus(itemId, 'failed', { errorMessage }),
    );
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
    return mapToQueueItem(updated);
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

    const mapped = items.map((i) => mapToQueueItem(i));

    return {
      queued: mapped.filter((i) => i.status === 'queued'),
      running: mapped.filter((i) => i.status === 'running'),
      waitingApproval: mapped.filter((i) => i.status === 'waiting_approval'),
      completed: mapped.filter(isCountedAsCompleted),
      failed: mapped.filter((i) => i.status === 'failed'),
      totalItems: mapped.length,
      maxConcurrency: this.getMaxConcurrency(),
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
    return items.map((i) => mapToQueueItem(i));
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
    return item ? mapToQueueItem(item) : null;
  }
}
