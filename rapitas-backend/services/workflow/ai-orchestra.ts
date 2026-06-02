/**
 * AI Orchestra Service
 *
 * Drives subtask execution for split parent tasks via the workflow queue/runner.
 * NOTE: The manual multi-task "conductor" surface (conductWorkflow/stop/resume +
 * dependency analysis/prioritization helpers) was removed along with its
 * /orchestra control-panel page as unused — subtask execution and plan-approval
 * resume are the only live entry points.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { WorkflowQueueService, type EnqueueOptions } from './workflow-queue';
import { WorkflowRunner } from './workflow-runner';
import { realtimeService } from '../communication/realtime-service';

const log = createLogger('ai-orchestra');

export interface OrchestraState {
  session: {
    id: number;
    status: string;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    startedAt: string | null;
  } | null;
  runner: {
    isRunning: boolean;
    activeItems: number;
    processedTotal: number;
  };
  queue: {
    queued: number;
    running: number;
    waitingApproval: number;
    completed: number;
    failed: number;
  };
}

export class AIOrchestra {
  private static instance: AIOrchestra;
  private currentSessionId: number | null = null;
  private queue: WorkflowQueueService;
  private runner: WorkflowRunner;

  private constructor() {
    this.queue = WorkflowQueueService.getInstance();
    this.runner = WorkflowRunner.getInstance();
  }

  static getInstance(): AIOrchestra {
    if (!AIOrchestra.instance) {
      AIOrchestra.instance = new AIOrchestra();
    }
    return AIOrchestra.instance;
  }

  /**
   * Get the current orchestra state.
   */
  async getState(): Promise<OrchestraState> {
    let sessionData = null;

    if (this.currentSessionId) {
      const session = await prisma.orchestraSession.findUnique({
        where: { id: this.currentSessionId },
      });
      if (session) {
        // Get latest counts
        const items = await this.queue.getSessionItems(this.currentSessionId);
        const completed = items.filter((i) => i.status === 'completed').length;
        const failed = items.filter((i) => i.status === 'failed').length;

        sessionData = {
          id: session.id,
          status: session.status,
          totalTasks: session.totalTasks,
          completedTasks: completed,
          failedTasks: failed,
          startedAt: session.startedAt?.toISOString() || null,
        };
      }
    }

    const runnerStatus = this.runner.getStatus();
    const queueState = await this.queue.getQueueState(this.currentSessionId ?? undefined);

    return {
      session: sessionData,
      runner: {
        isRunning: runnerStatus.isRunning,
        activeItems: runnerStatus.activeItems,
        processedTotal: runnerStatus.processedTotal,
      },
      queue: {
        queued: queueState.queued.length,
        running: queueState.running.length,
        waitingApproval: queueState.waitingApproval.length,
        completed: queueState.completed.length,
        failed: queueState.failed.length,
      },
    };
  }

  /**
   * Enqueue a single task.
   */
  async enqueueTask(
    options: EnqueueOptions,
  ): Promise<{ success: boolean; itemId?: number; error?: string }> {
    try {
      if (this.currentSessionId) {
        options.orchestraSessionId = this.currentSessionId;
      }
      const item = await this.queue.enqueue(options);

      // Update session total task count
      if (this.currentSessionId) {
        await prisma.orchestraSession.update({
          where: { id: this.currentSessionId },
          data: { totalTasks: { increment: 1 } },
        });
      }

      // Start runner if stopped
      if (!this.runner.getStatus().isRunning) {
        this.runner.startProcessing();
      }

      return { success: true, itemId: item.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg };
    }
  }

  /**
   * Enqueue all not-yet-done subtasks of a parent for SEQUENTIAL execution
   * (ascending id = creation order). The queue's sibling guard runs them one at
   * a time. Used after a parent plan is approved and split into subtasks: the
   * parent never implements directly — its subtasks do, and completing the last
   * one triggers the parent's integration verify.md (→ PR → parent done).
   *
   * @param parentTaskId - The split parent task. / 分割された親タスク
   * @returns Number of subtasks enqueued. / enqueue したサブタスク数
   */
  async enqueueSubtasksForExecution(parentTaskId: number): Promise<number> {
    const subtasks = await prisma.task.findMany({
      where: {
        parentId: parentTaskId,
        status: { notIn: ['done', 'cancelled', 'archived'] },
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    // The parent never implements directly — its subtasks do. Move it to
    // `in_progress` so (a) the UI shows it actively running its subtasks
    // instead of being stuck at plan_approved, and (b) the workflow file
    // guard later accepts the parent's integration verify.md (which is
    // rejected at plan_approved). Without this the parent was orphaned at
    // plan_approved and never completed after its subtasks finished.
    if (subtasks.length > 0) {
      await prisma.task
        .update({
          where: { id: parentTaskId },
          data: { workflowStatus: 'in_progress', status: 'in-progress' },
        })
        .catch((err) => {
          log.warn(
            { err, parentTaskId },
            '[AIOrchestra] Failed to move split parent to in_progress before enqueue',
          );
        });
    }

    let enqueued = 0;
    for (const st of subtasks) {
      try {
        const res = await this.enqueueTask({ taskId: st.id });
        if (res.success) enqueued++;
      } catch (err) {
        // enqueue throws on a duplicate (already queued/running) — non-fatal.
        log.warn({ err, subtaskId: st.id, parentTaskId }, '[AIOrchestra] Subtask enqueue skipped');
      }
    }
    if (enqueued > 0) {
      log.info(
        { parentTaskId, enqueued },
        '[AIOrchestra] Enqueued subtasks for sequential execution',
      );
    }
    return enqueued;
  }

  /**
   * Resume queue processing after plan approval.
   */
  async handlePlanApproved(taskId: number): Promise<void> {
    const resumed = await this.runner.resumeAfterApproval(taskId);
    if (resumed) {
      this.broadcastState('task_resumed');
    }
  }

  /**
   * Recover state on server startup.
   */
  async recoverOnStartup(): Promise<void> {
    // Recover stale queue items
    const recovered = await this.queue.recoverStaleItems();

    // Restore active session
    const activeSession = await prisma.orchestraSession.findFirst({
      where: { status: 'conducting' },
      orderBy: { updatedAt: 'desc' },
    });

    if (activeSession) {
      this.currentSessionId = activeSession.id;
      this.queue.setMaxConcurrency(activeSession.maxConcurrency);
      log.info(`[AIOrchestra] Recovered session ${activeSession.id} with ${recovered} stale items`);

      // Auto-resume
      this.runner.startProcessing();
    }
  }

  /**
   * Broadcast state via SSE.
   */
  private async broadcastState(event: string): Promise<void> {
    try {
      const state = await this.getState();
      realtimeService.broadcast('orchestra', event, {
        state,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Ignore SSE errors
    }
  }
}
