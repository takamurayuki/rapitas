/**
 * workflow-runner-item-loop
 *
 * The per-item phase loop of WorkflowRunner: reads the task's workflow status, advances one phase
 * at a time and settles the queue item (completed / waiting_approval / requeued / failed).
 * Extracted from workflow-runner.ts (file-size split); the loop first checks that the queue item
 * is still the runner's own (task 1568). Not responsible for dequeuing or for error handling —
 * see workflow-runner-item-errors.ts.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import type { QueueItem, WorkflowQueueService } from './workflow-queue';
import type { WorkflowOrchestrator } from './workflow-orchestrator';
import { resolveTaskWorkflowState, taskRowConfirmedAbsent } from '../task/task-resolver';
import { waitForVerifyCompletion, deferVerifyItem } from './workflow-runner-verify-settle';
import {
  resolveMaxIterations,
  resolvePhaseTimeoutMs,
  notifyParentOnSubtaskFailure,
  shouldAutoApprovePlan,
  raceWorkflowAdvance,
  waitBeforeNextPhase,
  logPhaseFailure,
  propagateSubtaskCompletion,
} from './workflow-runner-item-helpers';
import { taskVanishedMessage } from './queue-vanished-task-policy';
import { startPhaseUnlessHalted } from './workflow-runner-halt-guard';
import { isItemStillOwned } from './awaiting-ci-lookup';
import { guardQueueWrites, claimAdvance, handOffAfterAdvance } from './workflow-runner-item-claim';
import type { ActiveExecution } from './workflow-runner.types';

const log = createLogger('workflow-runner');

/** What the loop needs from the runner (kept narrow so the runner stays small). */
export interface ItemLoopDeps {
  queue: WorkflowQueueService;
  orchestrator: WorkflowOrchestrator;
  broadcastItemUpdate: (itemId: number, taskId: number, event: string, phase: string) => void;
  logPhaseTransition: (taskId: number, previousPhase: string, newPhase: string) => Promise<void>;
}

/**
 * Advance one queue item through the workflow until it settles.
 *
 * @param deps - Runner collaborators. / ランナーの協調オブジェクト
 * @param item - The dequeued item. / 取り出した項目
 * @param execution - Mutable execution record (current phase). / 実行記録
 * @param abortController - Aborted by the stop paths. / 停止用コントローラ
 */
export async function runItemPhaseLoop(
  deps: ItemLoopDeps,
  item: QueueItem,
  execution: ActiveExecution,
  abortController: AbortController,
): Promise<void> {
  // Progress workflow from current phase to completion (with infinite loop prevention)
  const maxIterations = resolveMaxIterations();
  // Task 1568: every item write and advance below is skipped once the item was handed back.
  const queue = guardQueueWrites(deps.queue, item.id, item.taskId, () => execution.currentPhase);
  let iterationCount = 0;

  while (!abortController.signal.aborted) {
    // NOTE: Checked before starting another pass, not after the loop: a pass that
    // finished the item (completed / waiting_approval / requeued) on the last
    // allowed iteration must not be re-reported as an exhausted budget.
    if (iterationCount >= maxIterations) {
      throw new Error(`Maximum iterations (${maxIterations}) exceeded for task ${item.taskId}`);
    }
    iterationCount++;
    // Task 1568: only a queue item that is still ours may be advanced. Once the scheduler handed it
    // back for a CI wait (or anything else took it from us), the task belongs to someone else —
    // the watcher may have completed it, ci-self-repair may have sent it back to implement — so
    // this runner must neither advance it nor rewrite the item.
    if (!(await isItemStillOwned(item.id))) {
      log.info(
        { taskId: item.taskId, itemId: item.id },
        '[WorkflowRunner] Queue item is no longer ours — withdrawing without advancing',
      );
      break;
    }
    // Check current workflowStatus
    const task = await resolveTaskWorkflowState(item.taskId);
    if (!task) {
      // Confirmed-vanished-task guard: the task row was CONFIRMED absent
      // (not a transient lookup failure), most often because the
      // dequeue-time guard in queue-dequeue-candidate.ts missed it (the
      // task was deleted AFTER dispatch). Cancel without consuming a
      // retry — retrying can never make a deleted row reappear, and doing
      // so previously wrote a meaningless task.blocked (task 651: task
      // 648). Not a `throw`: this must not go through retryIfPossible.
      if (await taskRowConfirmedAbsent(item.taskId)) {
        await queue.updateStatus(item.id, 'cancelled', {
          errorMessage: taskVanishedMessage(item.taskId),
          currentPhase: execution.currentPhase,
        });
        log.warn(
          `[WorkflowRunner] Task ${item.taskId} row confirmed absent — cancelling item ${item.id} without retry`,
        );
        deps.broadcastItemUpdate(item.id, item.taskId, 'execution_error', execution.currentPhase);
        break;
      }
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
      await queue.updateStatus(item.id, 'completed', {
        currentPhase: currentStatus,
        result: JSON.stringify({ completedAt: new Date().toISOString() }),
      });
      deps.broadcastItemUpdate(item.id, item.taskId, 'workflow_completed', currentStatus);
      propagateSubtaskCompletion(item.taskId, task.parentId);
      break;
    }

    if (currentStatus === 'verify_done') {
      // The async commit/PR/merge automation flips status→done (or bounces) after
      // verify.md lands; judging 'failed' first flashed a false "blocked" — wait.
      const settled = await waitForVerifyCompletion(item.taskId, abortController.signal, item.id);
      if (settled === 'completed') {
        await queue.updateStatus(item.id, 'completed', {
          currentPhase: 'completed',
          result: JSON.stringify({ completedAt: new Date().toISOString() }),
        });
        deps.broadcastItemUpdate(item.id, item.taskId, 'workflow_completed', 'completed');
        propagateSubtaskCompletion(item.taskId, task.parentId);
        break;
      }
      if (settled === 'moved') {
        // Left verify_done (e.g. self-repair bounce) — re-loop for the new phase.
        continue;
      }
      if (settled === 'deferred' || settled === 'held') {
        await deferVerifyItem(
          queue,
          item.id,
          settled === 'held' ? 'review_hold' : 'conflict_resolution_pending',
        );
        deps.broadcastItemUpdate(item.id, item.taskId, 'workflow_completed', 'verify_done');
        break;
      }
      if (settled === 'awaiting_ci') {
        // Task 1568: the scheduler already completed this item (`awaiting_ci`) and freed the
        // slot — only stop waiting; rewriting it would overwrite its completion record.
        deps.broadcastItemUpdate(item.id, item.taskId, 'workflow_completed', 'verify_done');
        break;
      }
      if (abortController.signal.aborted) {
        // The grace window ended because auto-run was STOPPED, not because the
        // task failed — don't mark it failed; the stop path owns the outcome.
        break;
      }
      // 'stuck': still verify_done after the grace window — a real, persistent
      // completion-gate failure, so surfacing it as failed is now correct.
      await queue.updateStatus(item.id, 'failed', {
        currentPhase: currentStatus,
        errorMessage:
          'verify.md was saved, but the task did not pass the completion gate. Check commit/PR/merge automation results.',
      });
      deps.broadcastItemUpdate(item.id, item.taskId, 'execution_failed', currentStatus);
      await notifyParentOnSubtaskFailure(item.taskId);
      break;
    }

    // plan_created: check auto-approve setting before waiting
    if (currentStatus === 'plan_created') {
      if (await shouldAutoApprovePlan(item.taskId)) {
        // NOTE: Auto-approve — skip waiting and advance immediately. Keep
        // task.status in sync with the workflow phase so the subtask-
        // completion handler (which reads both fields) never sees a stale
        // status and strands the parent.
        await prisma.task.update({
          where: { id: item.taskId },
          data: { workflowStatus: 'plan_approved', status: 'in-progress' },
        });
        deps.broadcastItemUpdate(item.id, item.taskId, 'phase_completed', 'plan_created');
        log.info(`[WorkflowRunner] Plan auto-approved for task ${item.taskId}`);
        continue;
      }

      await queue.updateStatus(item.id, 'waiting_approval', {
        currentPhase: 'plan_created',
      });
      deps.broadcastItemUpdate(item.id, item.taskId, 'waiting_approval', 'plan_created');
      break;
    }

    // Resolve the role the phase about to run dispatches as, so the backstop stays above the
    // implementer's raised wall-clock cap (task 546).
    const phaseTimeoutMs = await resolvePhaseTimeoutMs(task, currentStatus);
    if (abortController.signal.aborted) break;
    // An iteration-budget halt (task 1107), a paused theme or a restart wait (task 1562) must
    // stop new spend: the check and the start of the advance are one serialised section.
    const dispatch = await startPhaseUnlessHalted(
      queue,
      item,
      currentStatus,
      (e, p) => deps.broadcastItemUpdate(item.id, item.taskId, e, p),
      async () => {
        await deps.logPhaseTransition(item.taskId, currentStatus, 'advancing');
        if (abortController.signal.aborted) return null;
        deps.broadcastItemUpdate(item.id, item.taskId, 'phase_started', currentStatus);
        // Claimed before the call so advanceWorkflow starts synchronously (see claimAdvance).
        const orchestrator = await claimAdvance(
          deps.orchestrator,
          item.id,
          item.taskId,
          currentStatus,
        );
        if (abortController.signal.aborted) return null;
        return { completion: raceWorkflowAdvance(orchestrator, item.taskId, phaseTimeoutMs) };
      },
    );
    if (!dispatch) break;
    const result = await dispatch.completion;
    // Stop owns the queue item even when the old phase returns a replan/skip result.
    if (abortController.signal.aborted) {
      break;
    }
    if (await handOffAfterAdvance(item.id, item.taskId)) break;
    if (result.superseded) {
      await queue.updateStatus(item.id, 'queued', { currentPhase: result.status });
      deps.broadcastItemUpdate(item.id, item.taskId, 'execution_requeued', result.status);
      break;
    }

    // Another trigger already holds the task's execution lock and is
    // running this phase (the per-task mutex collapsed a duplicate). Do NOT
    // fail the item — return it to the queue so the next poll re-checks
    // once the in-flight phase has advanced the workflowStatus.
    if (result.skipped) {
      log[result.held ? 'debug' : 'info'](
        { taskId: item.taskId, phase: currentStatus, held: result.held },
        result.held
          ? `[WorkflowRunner] Implementer held (${result.held}) — re-queuing item`
          : '[WorkflowRunner] Phase already running elsewhere — re-queuing item',
      );
      await queue.updateStatus(item.id, 'queued', { currentPhase: currentStatus });
      deps.broadcastItemUpdate(item.id, item.taskId, 'execution_requeued', currentStatus);
      break;
    }

    if (!result.success) {
      // Surface WHY the phase failed. This used to be swallowed — only the
      // generic "Max retries (3) exceeded" surfaced — which hid root causes
      // like "role has no agent assigned" behind a silent retry loop.
      logPhaseFailure(log, item.taskId, currentStatus, result);
      // Persist the reason on the queue item so it is visible after retries.
      const retried = await queue.retryIfPossible(item.id, result.error ?? undefined);
      if (!retried) {
        deps.broadcastItemUpdate(item.id, item.taskId, 'execution_failed', currentStatus);
      } else {
        deps.broadcastItemUpdate(item.id, item.taskId, 'execution_retrying', currentStatus);
      }
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
      break;
    }

    // Task 1568: the phase may have ended with the task parked for CI and the item handed back; the
    // write below would turn that completed item back into `running` and revive a slot we no longer
    // hold.
    if (!(await isItemStillOwned(item.id))) {
      log.info(
        { taskId: item.taskId, itemId: item.id },
        '[WorkflowRunner] Queue item was handed back during the phase — not writing it back',
      );
      break;
    }

    // Phase completion notification + logging
    await deps.logPhaseTransition(item.taskId, currentStatus, result.status);
    await queue.updateStatus(item.id, 'running', {
      currentPhase: result.status,
    });
    deps.broadcastItemUpdate(item.id, item.taskId, 'phase_completed', result.status);

    // Brief wait before next phase (DB update stabilization + abort check)
    await waitBeforeNextPhase(abortController.signal);
  }
}
