/**
 * Workflow Queue Service
 *
 * Manages workflow task queuing with a hybrid in-memory queue + DB persistence approach.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';

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

export interface EnqueueOptions {
  taskId: number;
  priority?: number;
  dependencies?: number[];
  orchestraSessionId?: number;
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

export class WorkflowQueueService {
  private static instance: WorkflowQueueService;
  private maxConcurrency = 3;

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
    const { taskId, priority = 50, dependencies = [], orchestraSessionId } = options;

    // Verify task exists
    const task = await prisma.task.findUnique({ where: { id: taskId } });
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
        priority,
        status: 'queued',
        currentPhase: (task.workflowStatus as string) || 'draft',
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
  async retryIfPossible(itemId: number): Promise<boolean> {
    const item = await prisma.workflowQueueItem.findUnique({ where: { id: itemId } });
    if (!item) return false;

    if (item.retryCount >= item.maxRetries) {
      await this.updateStatus(itemId, 'failed', {
        errorMessage: `Max retries (${item.maxRetries}) exceeded`,
      });
      return false;
    }

    await prisma.workflowQueueItem.update({
      where: { id: itemId },
      data: {
        status: 'queued',
        retryCount: item.retryCount + 1,
        startedAt: null,
        errorMessage: null,
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
