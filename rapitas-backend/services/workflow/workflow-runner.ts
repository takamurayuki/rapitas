/**
 * Workflow Runner Service
 *
 * Dequeues tasks and executes each workflow phase asynchronously.
 * Uses the existing WorkflowOrchestrator for phase progression.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { WorkflowQueueService, type QueueItem } from './workflow-queue';
import { WorkflowOrchestrator } from './workflow-orchestrator';
import { realtimeService } from '../communication/realtime-service';

const log = createLogger('workflow-runner');

export interface RunnerStatus {
  isRunning: boolean;
  activeItems: number;
  processedTotal: number;
  pollIntervalMs: number;
}

interface ActiveExecution {
  queueItemId: number;
  taskId: number;
  startedAt: Date;
  currentPhase: string;
  abortController: AbortController;
}

export class WorkflowRunner {
  private static instance: WorkflowRunner;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs = 5000;
  private processedTotal = 0;
  private activeExecutions = new Map<number, ActiveExecution>();
  private queue: WorkflowQueueService;
  private orchestrator: WorkflowOrchestrator;

  private constructor() {
    this.queue = WorkflowQueueService.getInstance();
    this.orchestrator = WorkflowOrchestrator.getInstance();
  }

  static getInstance(): WorkflowRunner {
    if (!WorkflowRunner.instance) {
      WorkflowRunner.instance = new WorkflowRunner();
    }
    return WorkflowRunner.instance;
  }

  /**
   * Start the queue monitoring and processing loop.
   */
  startProcessing(intervalMs?: number): void {
    if (this.running) {
      log.warn('[WorkflowRunner] Already running');
      return;
    }

    this.running = true;
    if (intervalMs) this.pollIntervalMs = intervalMs;

    log.info(`[WorkflowRunner] Started processing (poll interval: ${this.pollIntervalMs}ms)`);
    this.broadcastStatus('runner_started');

    // Process once immediately, then start interval
    this.processQueue();
    this.pollTimer = setInterval(() => this.processQueue(), this.pollIntervalMs);
  }

  /**
   * Graceful shutdown.
   */
  async stopProcessing(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Cancel active executions
    for (const [itemId, exec] of this.activeExecutions) {
      exec.abortController.abort();
      try {
        await this.queue.updateStatus(itemId, 'queued', {
          errorMessage: 'Runner shutdown - returned to queue',
        });
      } catch (e) {
        log.warn({ err: e }, `[WorkflowRunner] Failed to requeue item ${itemId}`);
      }
    }
    this.activeExecutions.clear();

    log.info('[WorkflowRunner] Stopped processing');
    this.broadcastStatus('runner_stopped');
  }

  /**
   * Get runner status.
   */
  getStatus(): RunnerStatus {
    return {
      isRunning: this.running,
      activeItems: this.activeExecutions.size,
      processedTotal: this.processedTotal,
      pollIntervalMs: this.pollIntervalMs,
    };
  }

  /**
   * Dequeue items and process them.
   */
  private async processQueue(): Promise<void> {
    if (!this.running) return;

    try {
      // Dequeue while there are free slots
      while (this.activeExecutions.size < this.queue.getMaxConcurrency()) {
        const item = await this.queue.dequeue();
        if (!item) break;

        // Start execution async (fire-and-forget)
        this.executeWorkflowItem(item);
      }
    } catch (error) {
      log.error({ err: error }, '[WorkflowRunner] Error in processQueue');
    }
  }

  /**
   * Execute the entire workflow for a single task asynchronously.
   */
  private async executeWorkflowItem(item: QueueItem): Promise<void> {
    const abortController = new AbortController();
    const execution: ActiveExecution = {
      queueItemId: item.id,
      taskId: item.taskId,
      startedAt: new Date(),
      currentPhase: item.currentPhase,
      abortController,
    };

    this.activeExecutions.set(item.id, execution);
    this.broadcastItemUpdate(item.id, item.taskId, 'execution_started', item.currentPhase);

    try {
      // Progress workflow from current phase to completion (with infinite loop prevention)
      let continueLoop = true;
      const maxIterations = 20; // Prevent infinite loops
      let iterationCount = 0;

      while (continueLoop && !abortController.signal.aborted && iterationCount < maxIterations) {
        iterationCount++;
        // Check current workflowStatus
        const task = await prisma.task.findUnique({ where: { id: item.taskId } });
        if (!task) {
          throw new Error(`Task ${item.taskId} not found`);
        }

        const currentStatus = task.workflowStatus || 'draft';
        execution.currentPhase = currentStatus;

        // Completion check.
        // `verify_done` alone is not terminal: verify.md may have been written
        // while requested commit/PR/merge automation failed. Only `completed`
        // (or a done task for backwards compatibility) closes the queue item.
        if (
          currentStatus === 'completed' ||
          (currentStatus === 'verify_done' && task.status === 'done')
        ) {
          await this.queue.updateStatus(item.id, 'completed', {
            currentPhase: currentStatus,
            result: JSON.stringify({ completedAt: new Date().toISOString() }),
          });
          this.broadcastItemUpdate(item.id, item.taskId, 'workflow_completed', currentStatus);
          continueLoop = false;
          break;
        }

        if (currentStatus === 'verify_done') {
          await this.queue.updateStatus(item.id, 'failed', {
            currentPhase: currentStatus,
            errorMessage:
              'verify.md was saved, but the task did not pass the completion gate. Check commit/PR/merge automation results.',
          });
          this.broadcastItemUpdate(item.id, item.taskId, 'execution_failed', currentStatus);
          continueLoop = false;
          break;
        }

        // plan_created: check auto-approve setting before waiting
        if (currentStatus === 'plan_created') {
          const { prisma } = await import('../../config/database');
          const taskForApproval = await prisma.task.findUnique({
            where: { id: item.taskId },
            select: { autoApprovePlan: true, parentId: true },
          });
          const userSettings = await prisma.userSettings.findFirst();
          const isSubtask = taskForApproval?.parentId != null;
          const shouldAutoApprove =
            taskForApproval?.autoApprovePlan ||
            userSettings?.autoApprovePlan ||
            (isSubtask && (userSettings as Record<string, unknown>)?.autoApproveSubtaskPlan);

          if (shouldAutoApprove) {
            // NOTE: Auto-approve — skip waiting and advance immediately
            await prisma.task.update({
              where: { id: item.taskId },
              data: { workflowStatus: 'plan_approved' },
            });
            this.broadcastItemUpdate(item.id, item.taskId, 'phase_completed', 'plan_created');
            log.info(`[WorkflowRunner] Plan auto-approved for task ${item.taskId}`);
            continue;
          }

          await this.queue.updateStatus(item.id, 'waiting_approval', {
            currentPhase: 'plan_created',
          });
          this.broadcastItemUpdate(item.id, item.taskId, 'waiting_approval', 'plan_created');
          continueLoop = false;
          break;
        }

        // Log phase transition
        await this.logPhaseTransition(item.taskId, currentStatus, 'advancing');

        // Execute next phase (with timeout)
        this.broadcastItemUpdate(item.id, item.taskId, 'phase_started', currentStatus);

        const executionPromise = this.orchestrator.advanceWorkflow(item.taskId);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () => {
              reject(new Error(`Phase execution timeout for task ${item.taskId} (10 minutes)`));
            },
            10 * 60 * 1000,
          ); // 10-minute timeout
        });

        const result = await Promise.race([executionPromise, timeoutPromise]);

        if (!result.success) {
          // Check if retry is possible
          const retried = await this.queue.retryIfPossible(item.id);
          if (!retried) {
            this.broadcastItemUpdate(item.id, item.taskId, 'execution_failed', currentStatus);
          } else {
            this.broadcastItemUpdate(item.id, item.taskId, 'execution_retrying', currentStatus);
          }
          continueLoop = false;
          break;
        }

        // Phase completion notification + logging
        await this.logPhaseTransition(item.taskId, currentStatus, result.status);
        await this.queue.updateStatus(item.id, 'running', {
          currentPhase: result.status,
        });
        this.broadcastItemUpdate(item.id, item.taskId, 'phase_completed', result.status);

        // Brief wait before next phase (DB update stabilization + abort check)
        await new Promise((resolve) => {
          const waitTimeout = setTimeout(resolve, 1000);
          abortController.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(waitTimeout);
              resolve(undefined);
            },
            { once: true },
          );
        });
      }

      if (iterationCount >= maxIterations) {
        throw new Error(`Maximum iterations (${maxIterations}) exceeded for task ${item.taskId}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`[WorkflowRunner] Execution error for task ${item.taskId}: ${errorMsg}`);

      try {
        const retried = await this.queue.retryIfPossible(item.id);
        if (!retried) {
          await this.queue.updateStatus(item.id, 'failed', { errorMessage: errorMsg });
        }
      } catch (retryError) {
        log.error({ err: retryError }, `[WorkflowRunner] Failed to retry/fail item ${item.id}`);
      }
      this.broadcastItemUpdate(item.id, item.taskId, 'execution_error', execution.currentPhase);
    } finally {
      this.activeExecutions.delete(item.id);
      this.processedTotal++;
    }
  }

  /**
   * Resume a queue item after approval.
   */
  async resumeAfterApproval(taskId: number): Promise<boolean> {
    const item = await this.queue.findByTaskId(taskId);
    if (!item || item.status !== 'waiting_approval') {
      return false;
    }

    await this.queue.updateStatus(item.id, 'queued', { currentPhase: 'plan_approved' });
    log.info(`[WorkflowRunner] Resumed task ${taskId} after approval`);

    // Will be picked up in the next poll cycle
    return true;
  }

  /**
   * Record workflow phase transitions in ActivityLog and broadcast via SSE.
   */
  private async logPhaseTransition(
    taskId: number,
    previousPhase: string,
    newPhase: string,
  ): Promise<void> {
    const phaseLabels: Record<string, string> = {
      draft: '初期化',
      research_done: '調査完了',
      plan_created: '計画作成',
      plan_approved: '計画承認',
      in_progress: '実装中',
      verify_done: '検証完了',
      completed: '完了',
      advancing: '次フェーズへ進行中',
    };

    try {
      await prisma.activityLog.create({
        data: {
          taskId,
          action: 'workflow_phase_transition',
          metadata: JSON.stringify({
            previousPhase,
            newPhase,
            previousLabel: phaseLabels[previousPhase] || previousPhase,
            newLabel: phaseLabels[newPhase] || newPhase,
            timestamp: new Date().toISOString(),
          }),
          createdAt: new Date(),
        },
      });

      // Notify frontend of phase transition via SSE
      realtimeService.broadcast('orchestra', 'phase_transition', {
        taskId,
        previousPhase,
        newPhase,
        previousLabel: phaseLabels[previousPhase] || previousPhase,
        newLabel: phaseLabels[newPhase] || newPhase,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      log.warn(
        { err: error },
        `[WorkflowRunner] Failed to log phase transition for task ${taskId}`,
      );
    }
  }

  /**
   * Broadcast status via SSE.
   */
  private broadcastStatus(event: string): void {
    try {
      realtimeService.broadcast('orchestra', event, {
        runner: this.getStatus(),
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Runner continues even if SSE is unavailable
    }
  }

  /**
   * Broadcast item updates via SSE.
   */
  private broadcastItemUpdate(itemId: number, taskId: number, event: string, phase: string): void {
    try {
      realtimeService.broadcast('orchestra', 'item_update', {
        event,
        itemId,
        taskId,
        phase,
        activeCount: this.activeExecutions.size,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Runner continues even if SSE is unavailable
    }
  }
}
