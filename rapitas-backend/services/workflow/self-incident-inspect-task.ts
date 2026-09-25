/**
 * self-incident-inspect-task
 *
 * Runs the stagnation / tri-state desync / repeat-loop / supervisor detectors
 * over one candidate task and files a concern per finding. Split out of
 * self-incident-watcher.ts to keep it under the per-file line limit. NOT
 * responsible for candidate selection or per-pass gate resolution.
 */
import {
  detectStagnation,
  isBlockedEscalationRecent,
  detectTriStateDesync,
  detectRepeatLoop,
  isRepairBounceCause,
  STAGNATION_THRESHOLD_MS,
  DESYNC_RECOVERY_SETTLE_MS,
  PATTERN_A_SETTLE_MS,
  REPEAT_LOOP_WINDOW_MS,
  REPEAT_LOOP_MIN_COUNT,
  INVARIANT_REPEAT_LOOP_MIN_COUNT,
  MANUAL_STOP_WITHDRAW_CAUSE,
  BLOCKED_ESCALATION_CAUSES,
} from './incident-signature-detectors';
import { BLOCKED_REESCALATION_INTERVAL_MS } from './blocked-task-policy';
import { gatherTaskState } from './self-incident-evidence';
import { inspectSupervisorSignatures } from './supervisor-incident-inspect';
import { fileFinding, type CandidateTask } from './self-incident-file-finding';

/**
 * Runs all three detectors over one task and files a concern per finding.
 *
 * @param nonDevelopmentThemeIds - Themes with `isDevelopment === false`, resolved once per
 *   pass by the caller (task #860). / 非開発テーマID集合
 * @param workflowDisabledGlobally - `UserSettings.workflowDisabledGlobally`, resolved once per
 *   pass by the caller (task #860). / ワークフロー全体無効化フラグ
 * @param repairBounceMinCount - Dynamic repeat-loop threshold for verify_repair/ci_repair
 *   (task 837, resolved once per pass by the caller — see runSelfIncidentWatch). / 修復バウンス系の動的しきい値
 * @param themeAutoRunRunState - Themes actively running (`status='running'`) and their
 *   `currentTaskId`, resolved once per pass by the caller (task #969). / 稼働中テーマとcurrentTaskIdの対応
 * @param armedThemeIds - Themes whose blocked-task retry/escalation pipeline is armed
 *   (task 977, resolved once per pass by the caller). / blockedタスク自動再試行パイプラインが有効なテーマID集合
 */
export async function inspectTask(
  task: CandidateTask,
  nowMs: number,
  disabledAutoRunThemeIds: Set<number>,
  nonDevelopmentThemeIds: Set<number>,
  workflowDisabledGlobally: boolean,
  repairBounceMinCount: number,
  themeAutoRunRunState: Map<number, { currentTaskId: number | null }>,
  armedThemeIds: Set<number>,
): Promise<number> {
  const state = await gatherTaskState(task, nowMs, REPEAT_LOOP_WINDOW_MS);
  let filed = 0;

  // Structural dispatch gate (#860): a task that can never gain a live
  // execution/queue item — workflow disabled, non-development theme, or
  // theme auto-run disabled — is a legitimate indefinite wait, not
  // stagnation. Unthemed tasks fall through to `true` (managed) on purpose —
  // see incident-signature-detectors.ts's isWorkflowManaged JSDoc.
  const isWorkflowManaged =
    task.workflowDisabled || workflowDisabledGlobally
      ? false
      : task.themeId != null && nonDevelopmentThemeIds.has(task.themeId)
        ? false
        : task.themeId != null && disabledAutoRunThemeIds.has(task.themeId)
          ? false
          : true;

  const manuallyWithdrawn = state.latestTransitionCause === MANUAL_STOP_WITHDRAW_CAUSE;
  // Theme is actively dispatching a DIFFERENT task → this task is a normal
  // backlog wait, not stagnation (#969). Does NOT suppress when currentTaskId
  // is this task itself — a live hang on the task's own turn must still fire.
  const runState = task.themeId != null ? themeAutoRunRunState.get(task.themeId) : undefined;
  const themeAutoRunBusyWithOtherTask =
    runState != null && runState.currentTaskId != null && runState.currentTaskId !== task.id;
  const blockedEscalated =
    state.latestTransitionCause != null &&
    BLOCKED_ESCALATION_CAUSES.has(state.latestTransitionCause);
  // Blocked + armed-theme tasks are already owned by the blocked-task
  // retry/escalation pipeline (task 977) — undefined for non-blocked tasks
  // per StagnationInput.blockedRetryPipelineArmed's fail-open convention.
  const blockedRetryPipelineArmed =
    task.status === 'blocked' ? task.themeId != null && armedThemeIds.has(task.themeId) : undefined;
  const stagnation = detectStagnation({
    taskStatus: task.status,
    workflowStatus: task.workflowStatus,
    // The freshest of the task row itself and its newest transition — either
    // one moving means the task is not idle.
    lastActivityAtMs: Math.max(state.taskUpdatedAtMs, state.latestTransitionAtMs ?? 0),
    hasLiveExecution: state.hasLiveExecution,
    hasAnyExecution: state.hasAnyExecution,
    hasActiveQueueItem: state.hasActiveQueueItem,
    isWorkflowManaged,
    manuallyWithdrawn,
    themeAutoRunBusyWithOtherTask,
    blockedEscalatedAtMs: state.latestBlockedEscalationAtMs,
    blockedHoldMs: BLOCKED_REESCALATION_INTERVAL_MS,
    blockedEscalationRecent: isBlockedEscalationRecent(state.latestBlockedEscalationAtMs, nowMs),
    blockedEscalated,
    blockedRetryPipelineArmed,
    nowMs,
  });
  if (stagnation) {
    const staleMin = Math.round(stagnation.staleMs / 60_000);
    if (
      await fileFinding({
        signature: 'stagnation',
        task,
        state,
        title: '[自己検出] 停滞: 実行もキューも無いまま非終端タスクが放置される',
        explanation:
          `非終端タスク(status=${task.status}, workflowStatus=${task.workflowStatus ?? 'null'})が、` +
          `実行中エージェントもアクティブなキュー項目も無いまま${staleMin}分間更新されていません。`,
        thresholdDescription:
          `停滞閾値 ${Math.round(STAGNATION_THRESHOLD_MS / 60_000)}分` +
          `（実行なし・キューなし・正当な待機状態でない非終端タスクが対象）`,
        // A task orphaned with no runner and no queue never advances on its own; the
        // concern's contract (#979) is bug/high from the first detection, not only on recurrence.
        severity: 'high',
        nowMs,
      })
    ) {
      filed++;
    }
  }

  // Pattern B's recovery grace scans the whole timeline, not just the newest
  // cause (#775): a live process's delayed save can land after a recovery
  // transition has already aged off the "latest" slot.
  const desync = detectTriStateDesync({
    taskStatus: task.status,
    workflowStatus: task.workflowStatus,
    latestSessionStatus: state.latestSessionStatus,
    latestExecutionStatus: state.latestExecutionStatus,
    recentTransitions: state.timeline.map((t) => ({
      cause: t.cause,
      createdAtMs: new Date(t.createdAt).getTime(),
    })),
    latestSessionUpdatedAtMs: state.latestSessionUpdatedAtMs,
    themeAutoRunEnabled: task.themeId != null ? !disabledAutoRunThemeIds.has(task.themeId) : null,
    manuallyWithdrawn,
    themeAutoRunBusyWithOtherTask,
    taskHalted: task.haltReason != null,
    autoRunExcluded: task.autoRunExcluded === true,
    nowMs,
  });
  if (desync) {
    const signature =
      desync.kind === 'session_failed_execution_active'
        ? 'tristate-desync:session-failed-exec-active'
        : 'tristate-desync:todo-workflow-advanced';
    if (
      await fileFinding({
        signature,
        task,
        state,
        title: `[自己検出] 状態不整合: ${desync.detail}`,
        explanation:
          `Task/AgentSession/AgentExecution の状態が矛盾しています: ${desync.detail}。` +
          `（task.status=${task.status}, workflowStatus=${task.workflowStatus ?? 'null'}）`,
        thresholdDescription:
          desync.kind === 'todo_status_workflow_advanced'
            ? `即時判定（ただし回復遷移 reconciler_requeue/artifact_reuse_fastforward/task_retried から` +
              `${Math.round(DESYNC_RECOVERY_SETTLE_MS / 60_000)}分間は定着待ちとして除外）`
            : `即時判定（ただしセッション最終更新から${Math.round(PATTERN_A_SETTLE_MS / 1000)}秒間は` +
              `定着待ちとして除外）`,
        severity: 'high',
        nowMs,
      })
    ) {
      filed++;
    }
  }

  const loop = detectRepeatLoop({
    transitions: state.windowedCauses,
    nowMs,
    taskStatus: task.status,
    repairBounceMinCount,
  });
  if (loop) {
    // Which threshold actually fired (task 837): invariant path keeps its own
    // fixed threshold; general path uses the dynamic repair-bounce threshold
    // only for verify_repair/ci_repair, else the static REPEAT_LOOP_MIN_COUNT.
    const effectiveMinCount =
      loop.via === 'invariant'
        ? INVARIANT_REPEAT_LOOP_MIN_COUNT
        : isRepairBounceCause(loop.cause)
          ? repairBounceMinCount
          : REPEAT_LOOP_MIN_COUNT;
    if (
      await fileFinding({
        signature: `repeat-loop:${loop.cause}`,
        task,
        state,
        title: `[自己検出] 反復ループ: cause=${loop.cause} が短時間に繰り返される`,
        explanation:
          `直近${Math.round(REPEAT_LOOP_WINDOW_MS / 60_000)}分以内に同一cause(${loop.cause})の` +
          `遷移が${loop.count}回発生しています。同じ失敗と再試行を繰り返すループの疑いがあります。`,
        // Must state the threshold that actually fired (task 710) — which for
        // REPAIR_BOUNCE_CAUSES is now the budget-derived one, not the static min.
        thresholdDescription: `${Math.round(REPEAT_LOOP_WINDOW_MS / 60_000)}分以内に同一causeが${effectiveMinCount}回以上`,
        severity: 'high',
        nowMs,
      })
    ) {
      filed++;
    }
  }

  // Supervisor-derived signatures (cwd mismatch / false failure / false
  // force-stop / theme misplacement) share the same filing path via DI.
  filed += await inspectSupervisorSignatures({ task, state, nowMs, file: fileFinding });

  return filed;
}
