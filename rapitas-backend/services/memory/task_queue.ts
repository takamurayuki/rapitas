/**
 * Memory System Background Job Queue
 *
 * Polls every 5 seconds, retries up to 3 times, then moves to dead_letter.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type { MemoryTaskType } from './types';

const log = createLogger('memory:task-queue');

type TaskHandler = (payload: Record<string, unknown>) => Promise<void>;

export class MemoryTaskQueueProcessor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private handlers = new Map<string, TaskHandler>();
  private isProcessing = false;
  private pollIntervalMs: number;

  constructor(pollIntervalMs = 5000) {
    this.pollIntervalMs = pollIntervalMs;
  }

  /**
   * Register a handler for a task type.
   */
  registerHandler(taskType: MemoryTaskType, handler: TaskHandler): void {
    this.handlers.set(taskType, handler);
    log.debug({ taskType }, 'Task handler registered');
  }

  /**
   * Start the worker.
   */
  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.processNext().catch((err) => {
        log.error({ err }, 'Queue processing error');
      });
    }, this.pollIntervalMs);

    log.info({ pollIntervalMs: this.pollIntervalMs }, 'Memory task queue worker started');
  }

  /**
   * Stop the worker.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      log.info('Memory task queue worker stopped');
    }
  }

  /**
   * Enqueue a task.
   */
  async enqueue(
    taskType: MemoryTaskType,
    payload: Record<string, unknown> = {},
    priority = 0,
    scheduledAt?: Date,
  ): Promise<number> {
    const task = await prisma.memoryTaskQueue.create({
      data: {
        taskType,
        payload: JSON.stringify(payload),
        priority,
        status: 'pending',
        scheduledAt: scheduledAt ?? new Date(),
      },
    });
    log.debug({ taskType, taskId: task.id, priority }, 'Task enqueued');
    return task.id;
  }

  /**
   * Fetch and process the next task.
   */
  private async processNext(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Get the highest-priority pending task past its scheduled time
      const task = await prisma.memoryTaskQueue.findFirst({
        where: {
          status: 'pending',
          scheduledAt: { lte: new Date() },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      });

      if (!task) return;

      const handler = this.handlers.get(task.taskType);
      if (!handler) {
        log.warn({ taskType: task.taskType, taskId: task.id }, 'No handler for task type');
        return;
      }

      // Update to processing
      await prisma.memoryTaskQueue.update({
        where: { id: task.id },
        data: { status: 'processing', startedAt: new Date(), attempts: task.attempts + 1 },
      });

      try {
        const payload = JSON.parse(task.payload);
        await handler(payload);

        // Update to completed
        await prisma.memoryTaskQueue.update({
          where: { id: task.id },
          data: { status: 'completed', completedAt: new Date() },
        });
        log.debug({ taskType: task.taskType, taskId: task.id }, 'Task completed');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const newAttempts = task.attempts + 1;

        if (newAttempts >= task.maxAttempts) {
          // Move to dead_letter
          await prisma.memoryTaskQueue.update({
            where: { id: task.id },
            data: { status: 'dead_letter', errorMessage: message },
          });
          log.error(
            { taskType: task.taskType, taskId: task.id, attempts: newAttempts },
            'Task moved to dead_letter',
          );
        } else {
          // Retry: return to pending
          await prisma.memoryTaskQueue.update({
            where: { id: task.id },
            data: { status: 'pending', errorMessage: message },
          });
          log.warn(
            { taskType: task.taskType, taskId: task.id, attempts: newAttempts },
            'Task failed, will retry',
          );
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get queue status counts.
   */
  async getStatus(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    deadLetter: number;
  }> {
    const counts = await prisma.memoryTaskQueue.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    const result = { pending: 0, processing: 0, completed: 0, failed: 0, deadLetter: 0 };
    for (const c of counts) {
      switch (c.status) {
        case 'pending':
          result.pending = c._count.id;
          break;
        case 'processing':
          result.processing = c._count.id;
          break;
        case 'completed':
          result.completed = c._count.id;
          break;
        case 'failed':
          result.failed = c._count.id;
          break;
        case 'dead_letter':
          result.deadLetter = c._count.id;
          break;
      }
    }
    return result;
  }
}
