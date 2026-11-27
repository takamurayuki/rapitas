/**
 * Workflow Runner Service
 *
 * Dequeues tasks and executes each workflow phase asynchronously.
 * Uses the existing WorkflowOrchestrator for phase progression.
 */
import { createLogger } from '../../config/logger';
import { WorkflowQueueService, type QueueItem } from './workflow-queue';
import { WorkflowOrchestrator } from './workflow-orchestrator';
import {
  logPhaseTransition,
  broadcastRunnerStatus,
  broadcastItemUpdate,
} from './workflow-runner-events';
import { slowQueueFields } from './workflow-runner-item-helpers';
import { markEventLoopSection } from '../system/event-loop-lag-watchdog';
import * as staleActive from './workflow-runner-stale-active';
import { runItemPhaseLoop, type ItemLoopDeps } from './workflow-runner-item-loop';
import { guardQueueWrites } from './workflow-runner-item-claim';
import { settleItemError } from './workflow-runner-item-errors';
import type { RunnerStatus, ActiveExecution } from './workflow-runner.types';

export type { RunnerStatus } from './workflow-runner.types';

const log = createLogger('workflow-runner');

export class WorkflowRunner {
  private static instance: WorkflowRunner;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  // NOTE: Extended from 5s to 10s — phases take minutes; 10s adds at most 10s
  // of inter-phase latency which is imperceptible but halves idle DB query rate.
  private pollIntervalMs = 10_000;
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
   * Whether the polling loop is currently active.
   *
   * The queue-stall reconciler needs this to tell two situations apart that
   * look identical from the queue table: a runner that has stopped (kicking it
   * helps) and a runner that is alive but not claiming items (kicking it is a
   * no-op). Without it the reconciler logged "restarted WorkflowRunner" 78
   * times in one day against a runner that answered "Already running" every
   * time (measured 2026-08-28).
   *
   * @returns true while the poll loop is running. / ポーリング稼働中は true
   */
  isProcessing(): boolean {
    return this.running;
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
        // Task 1568: CAS on the item (`running` only) — a shutdown that arrives just after the
        // scheduler handed the item back must not turn a `completed` item into `queued` again.
        await guardQueueWrites(
          this.queue,
          itemId,
          exec.taskId,
          () => exec.currentPhase,
        ).updateStatus(itemId, 'queued', {
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
    return staleActive.abortTaskExecutions(this.activeExecutions, taskId);
  }

  /** Free the slot of an item cancelled in the DB by the sweep/reconciler (task 1165). */
  releaseQueueItem(queueItemId: number): boolean {
    return staleActive.releaseActiveExecution(this.activeExecutions, queueItemId);
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

  /** Dequeue items and process them. */
  private async processQueue(): Promise<void> {
    if (!this.running) return;
    const t0 = Date.now();
    const ids: number[] = []; // task 1114: correlates a slow-queue WARN with items
    const releaseSection = markEventLoopSection('workflow-runner:processQueue'); // task 1040: names this section on a concurrent event-loop-lag WARN
    try {
      // task 1165: a sweep-cancelled item leaves a Map entry that would hold the slot forever
      await staleActive.dropStaleActiveExecutions(this.activeExecutions);
      while (this.activeExecutions.size < this.queue.getMaxConcurrency()) {
        const item = await this.queue.dequeue();
        if (!item) break;
        ids.push(item.taskId);
        this.executeWorkflowItem(item); // fire-and-forget
      }
    } catch (error) {
      log.error({ err: error }, '[WorkflowRunner] Error in processQueue');
    } finally {
      releaseSection();
      const tookMs = Date.now() - t0; // task 966: diagnostic instrumentation for concern #966 (event-loop-lag WARN)
      if (tookMs > 1000) log.warn(slowQueueFields(ids, tookMs), 'Slow queue processing');
    }
  }

  /** Execute the entire workflow for a single task asynchronously. */
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
      await runItemPhaseLoop(this.loopDeps(), item, execution, abortController);
    } catch (error) {
      await settleItemError(this.loopDeps(), item, execution, error);
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

  /** Collaborators handed to the per-item loop (workflow-runner-item-loop.ts). */
  private loopDeps(): ItemLoopDeps {
    return {
      queue: this.queue,
      orchestrator: this.orchestrator,
      broadcastItemUpdate: (id, taskId, event, phase) =>
        this.broadcastItemUpdate(id, taskId, event, phase),
      logPhaseTransition: (taskId, prev, next) => this.logPhaseTransition(taskId, prev, next),
    };
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
