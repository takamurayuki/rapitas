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
import {
  logPhaseTransition,
  broadcastRunnerStatus,
  broadcastItemUpdate,
} from './workflow-runner-events';
import { isShutdownError } from '../agents/orchestrator/shutdown-error';

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

    // Cancel active executions. Aborting the controller only stops the loop
    // from starting the NEXT phase — the agent process spawned for the CURRENT
    // phase keeps running until killed. stopTaskAgents kills every in-flight
    // agent for the task so shutdown actually halts work in progress.
    const { stopTaskAgents } = await import('../agents/stop-task-agents');
    for (const [itemId, exec] of this.activeExecutions) {
      exec.abortController.abort();
      await stopTaskAgents(exec.taskId, { errorMessage: 'Runner shutdown' }).catch((e) => {
        log.warn({ err: e, taskId: exec.taskId }, '[WorkflowRunner] Failed to stop agents');
      });
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
   * Abort the in-flight phase loop(s) for a task. Used by stop paths (auto-run
   * stop / manual stop) so the runner does NOT advance to or retry another
   * phase after the agent is killed. Without this, a stop that landed between
   * phases let the loop spawn the next phase's agent — the agent "wouldn't
   * stop". Combined with the cancelled-item retry guard in WorkflowQueueService.
   *
   * @param taskId - The task whose in-flight execution should be aborted. / 中断対象タスクID
   * @returns Number of executions aborted. / 中断した実行数
   */
  abortTask(taskId: number): number {
    let aborted = 0;
    for (const exec of this.activeExecutions.values()) {
      if (exec.taskId === taskId && !exec.abortController.signal.aborted) {
        exec.abortController.abort();
        aborted++;
      }
    }
    if (aborted > 0) {
      log.info(`[WorkflowRunner] Aborted ${aborted} in-flight execution(s) for task ${taskId}`);
    }
    return aborted;
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

          // Propagate completion to the parent when this was a subtask. The
          // subtask reaches its terminal state here (queue-driven), not via the
          // task API, so this is the path that must notify the parent. The
          // handler no-ops for non-subtasks (parentId === null).
          if (task.parentId) {
            const { onSubtaskCompleted } = await import('./subtask-completion-handler');
            onSubtaskCompleted(item.taskId).catch((err) => {
              log.warn(
                { err, taskId: item.taskId, parentId: task.parentId },
                '[WorkflowRunner] Failed to propagate subtask completion to parent',
              );
            });
          }

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
          await this.notifyParentOnSubtaskFailure(item.taskId);
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
            // NOTE: Auto-approve — skip waiting and advance immediately. Keep
            // task.status in sync with the workflow phase so the subtask-
            // completion handler (which reads both fields) never sees a stale
            // status and strands the parent.
            await prisma.task.update({
              where: { id: item.taskId },
              data: { workflowStatus: 'plan_approved', status: 'in-progress' },
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
        const { getPhaseTimeoutMs } = await import('../agents/execution-timeouts');
        const phaseTimeoutMs = getPhaseTimeoutMs();
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            const mins = Math.round(phaseTimeoutMs / 60000);
            reject(new Error(`Phase execution timeout for task ${item.taskId} (${mins} minutes)`));
          }, phaseTimeoutMs);
        });

        const result = await Promise.race([executionPromise, timeoutPromise]);

        // Another trigger already holds the task's execution lock and is
        // running this phase (the per-task mutex collapsed a duplicate). Do NOT
        // fail the item — return it to the queue so the next poll re-checks
        // once the in-flight phase has advanced the workflowStatus.
        if (result.skipped) {
          log.info(
            { taskId: item.taskId, phase: currentStatus },
            '[WorkflowRunner] Phase already running elsewhere — re-queuing item',
          );
          await this.queue.updateStatus(item.id, 'queued', { currentPhase: currentStatus });
          this.broadcastItemUpdate(item.id, item.taskId, 'execution_requeued', currentStatus);
          continueLoop = false;
          break;
        }

        if (!result.success) {
          // Surface WHY the phase failed. This used to be swallowed — only the
          // generic "Max retries (3) exceeded" surfaced — which hid root causes
          // like "role has no agent assigned" behind a silent retry loop.
          log.warn(
            { taskId: item.taskId, phase: currentStatus, role: result.role, error: result.error },
            `[WorkflowRunner] Phase failed for task ${item.taskId}: ${result.error ?? 'unknown error'}`,
          );
          // Persist the reason on the queue item so it is visible after retries.
          const retried = await this.queue.retryIfPossible(item.id, result.error ?? undefined);
          if (!retried) {
            this.broadcastItemUpdate(item.id, item.taskId, 'execution_failed', currentStatus);
          } else {
            this.broadcastItemUpdate(item.id, item.taskId, 'execution_retrying', currentStatus);
          }
          continueLoop = false;
          break;
        }

        // Stop here if the run was aborted (e.g. auto-run stopped) — even when
        // the phase just succeeded. Advancing / writing 'running' would resurrect
        // the queue item that the stop path cancelled and spawn the next phase's
        // agent, so the "stop" would never actually stop.
        if (abortController.signal.aborted) {
          log.info(
            { taskId: item.taskId, phase: currentStatus },
            '[WorkflowRunner] Execution aborted — stopping loop without advancing',
          );
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

      // NOTE: Shutdown errors are graceful interruptions — requeue without consuming retry budget.
      // Mirrors stopProcessing() at line 99 which also uses updateStatus(..., 'queued', ...).
      if (isShutdownError(error)) {
        log.warn(`[WorkflowRunner] Task ${item.taskId} interrupted by shutdown — requeued`);
        try {
          await this.queue.updateStatus(item.id, 'queued', {
            errorMessage: 'Shutdown - returned to queue',
          });
        } catch (requeueError) {
          log.warn(
            { err: requeueError },
            `[WorkflowRunner] Failed to requeue item ${item.id} after shutdown`,
          );
        }
        this.broadcastItemUpdate(item.id, item.taskId, 'execution_error', execution.currentPhase);
        return;
      }

      log.error(`[WorkflowRunner] Execution error for task ${item.taskId}: ${errorMsg}`);

      // Kill any in-flight agent BEFORE retrying/failing. The phase timeout only
      // rejects the race — the agent process it abandoned keeps running and
      // holds the task's execution lock, so every retry would collapse to
      // 'skipped' while the zombie agent burns tokens (indefinitely for items
      // outside auto-run, which have no theme wall guard). No-op when the agent
      // already exited (normal failures).
      try {
        const { stopTaskAgents } = await import('../agents/stop-task-agents');
        await stopTaskAgents(item.taskId, { errorMessage: `Phase failed: ${errorMsg}` });
      } catch (stopError) {
        log.warn(
          { err: stopError, taskId: item.taskId },
          '[WorkflowRunner] Failed to stop agents after phase error',
        );
      }

      try {
        const retried = await this.queue.retryIfPossible(item.id, errorMsg);
        if (!retried) {
          await this.queue.updateStatus(item.id, 'failed', { errorMessage: errorMsg });
          // Terminal failure (no retry left) — let a split parent finalize.
          await this.notifyParentOnSubtaskFailure(item.taskId);
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
   * When a SUBTASK's queue item ends in a non-completed terminal state, the
   * 'completed' path that normally notifies the parent never runs — so the
   * parent's "all siblings terminal" gate (onSubtaskCompleted) is never
   * re-evaluated and the parent hangs forever at in-progress. Terminalize the
   * subtask's task.status and notify the parent so it can finalize (as blocked
   * when a subtask failed). No-op for non-subtasks (parentId === null).
   *
   * @param taskId - The failed subtask's id / 失敗したサブタスクID
   */
  private async notifyParentOnSubtaskFailure(taskId: number): Promise<void> {
    try {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { parentId: true, status: true },
      });
      if (!task?.parentId) return;
      // 'failed' is terminal for onSubtaskCompleted's all-siblings-done gate.
      if (!['done', 'failed', 'cancelled', 'archived'].includes(task.status)) {
        await prisma.task
          .update({ where: { id: taskId }, data: { status: 'failed', completedAt: new Date() } })
          .catch(() => {});
      }
      const { onSubtaskCompleted } = await import('./subtask-completion-handler');
      await onSubtaskCompleted(taskId).catch((err) => {
        log.warn({ err, taskId }, '[WorkflowRunner] Parent finalize after subtask failure failed');
      });
    } catch (err) {
      log.warn({ err, taskId }, '[WorkflowRunner] notifyParentOnSubtaskFailure failed');
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

  /** Delegate: record + broadcast a phase transition (see workflow-runner-events). */
  private async logPhaseTransition(
    taskId: number,
    previousPhase: string,
    newPhase: string,
  ): Promise<void> {
    await logPhaseTransition(taskId, previousPhase, newPhase);
  }

  /** Delegate: broadcast runner lifecycle status (see workflow-runner-events). */
  private broadcastStatus(event: string): void {
    broadcastRunnerStatus(event, this.getStatus());
  }

  /** Delegate: broadcast a queue-item update (see workflow-runner-events). */
  private broadcastItemUpdate(itemId: number, taskId: number, event: string, phase: string): void {
    broadcastItemUpdate(itemId, taskId, event, phase, this.activeExecutions.size);
  }
}
