/**
 * workflow-runner-events
 *
 * ActivityLog + SSE event emission for the WorkflowRunner: phase transitions,
 * runner status, and queue-item updates. Extracted from workflow-runner.ts
 * (file-size split); contains no scheduling or execution logic.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { realtimeService } from '../communication/realtime-service';
import { logCycleEvent } from '../observability';
import type { RunnerStatus } from './workflow-runner';

const log = createLogger('workflow-runner');

// Labels reflect the phase ACTUALLY running at each status (see buildTransitions):
// the implementer runs at plan_approved (→ in_progress), the verifier runs at
// in_progress (→ verify_done). So plan_approved = 実装中 and in_progress = 検証中
// — keeping these in sync with the frontend status badge so the live transition
// log doesn't say 実装中 while the task is actually verifying.
const PHASE_LABELS: Record<string, string> = {
  draft: '調査中',
  research_done: '計画中',
  plan_created: '計画作成済',
  plan_approved: '実装中',
  in_progress: '検証中',
  verify_done: '検証完了',
  awaiting_question: '回答待ち',
  blocked: 'ブロック中',
  completed: '完了',
  advancing: '次フェーズへ進行中',
};

/**
 * Record a workflow phase transition in ActivityLog and broadcast it via SSE.
 * Best-effort: failures are logged and swallowed.
 *
 * @param taskId - Task whose phase changed / フェーズが変わったタスクID
 * @param previousPhase - Phase before the transition / 遷移前フェーズ
 * @param newPhase - Phase after the transition / 遷移後フェーズ
 */
export async function logPhaseTransition(
  taskId: number,
  previousPhase: string,
  newPhase: string,
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        taskId,
        action: 'workflow_phase_transition',
        metadata: JSON.stringify({
          previousPhase,
          newPhase,
          previousLabel: PHASE_LABELS[previousPhase] || previousPhase,
          newLabel: PHASE_LABELS[newPhase] || newPhase,
          timestamp: new Date().toISOString(),
        }),
        createdAt: new Date(),
      },
    });

    realtimeService.broadcast('orchestra', 'phase_transition', {
      taskId,
      previousPhase,
      newPhase,
      previousLabel: PHASE_LABELS[previousPhase] || previousPhase,
      newLabel: PHASE_LABELS[newPhase] || newPhase,
      timestamp: new Date().toISOString(),
    });

    // Skip the AI cycle log for the synthetic 'advancing' pseudo-phase (the
    // runner emits previousPhase→'advancing' on EVERY poll tick before a phase
    // runs) and for no-op transitions (previousPhase===newPhase). Both are
    // poll-rate noise that otherwise drowns every real lifecycle event in the
    // cycle stream. The human UI trail (ActivityLog + broadcast above) still
    // records them, so the UI is unaffected.
    if (newPhase !== 'advancing' && previousPhase !== newPhase) {
      logCycleEvent('phase.transition', {
        task: taskId,
        from: previousPhase,
        to: newPhase,
        msg: `${PHASE_LABELS[previousPhase] || previousPhase} → ${PHASE_LABELS[newPhase] || newPhase}`,
      });
    }
  } catch (error) {
    log.warn({ err: error }, `[WorkflowRunner] Failed to log phase transition for task ${taskId}`);
  }
}

/**
 * Broadcast the runner's lifecycle status via SSE. Never throws.
 *
 * @param event - Event name (runner_started / runner_stopped) / イベント名
 * @param status - Current runner status snapshot / ランナー状態
 */
export function broadcastRunnerStatus(event: string, status: RunnerStatus): void {
  try {
    realtimeService.broadcast('orchestra', event, {
      runner: status,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Runner continues even if SSE is unavailable
  }
}

/**
 * Broadcast a queue-item update via SSE. Never throws.
 *
 * @param itemId - Queue item id / キューアイテムID
 * @param taskId - Task id / タスクID
 * @param event - Item event name / アイテムイベント名
 * @param phase - Current workflow phase / 現在フェーズ
 * @param activeCount - Number of in-flight executions / 実行中数
 */
export function broadcastItemUpdate(
  itemId: number,
  taskId: number,
  event: string,
  phase: string,
  activeCount: number,
): void {
  try {
    realtimeService.broadcast('orchestra', 'item_update', {
      event,
      itemId,
      taskId,
      phase,
      activeCount,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Runner continues even if SSE is unavailable
  }
}
