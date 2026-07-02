/**
 * executionPollCompletion
 *
 * Handlers for the 'completed' execution status, including the workflow
 * phase-advance logic that decides whether polling should keep running after a
 * phase finishes. Terminal-failure statuses live in the sibling terminal module.
 */

import { type ExecutionStreamState, trimLogs } from './execution-stream-types';
import { logger, type PollRefs } from './execution-poll-shared';

/** Translator function shape accepted by the poll-completion handlers. */
export type PollTranslate = (key: string, params?: Record<string, string | number>) => string;

/** Resolves `{param}` placeholders in a template string. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in params ? String(params[key]) : match,
  );
}

const JA_TEMPLATES: Record<string, string> = {
  completedLog: '[完了] 実行が完了しました。',
  'workflowPhase.researcher':
    '[調査完了] 調査フェーズが完了しました。次のフェーズへ自動で進みます...',
  'workflowPhase.planner':
    '[計画作成完了] 計画フェーズが完了しました。自動承認が有効な場合はそのまま実装へ進みます（無効の場合のみ計画タブで承認してください）。',
  'workflowPhase.reviewer':
    '[レビュー完了] レビューフェーズが完了しました。自動承認が有効な場合はそのまま実装へ進みます（無効の場合のみ計画タブで承認してください）。',
  'workflowPhase.implementer': '[実装完了] 実装フェーズが完了しました。検証フェーズを自動実行中...',
  'workflowPhase.verifier':
    '[検証完了] 検証フェーズが完了しました。問題がなければステータスは自動で「完了」になります。',
  'workflowPhase.default': '[フェーズ完了] {mode}が完了しました。',
  prCreatedLog: '[PR作成] PRを作成しました: {info}',
  failedLog: '[Error] {message}',
  failedDefaultMessage: '実行に失敗しました',
  cancelledLog: '[キャンセル] 実行が停止されました。',
  interruptedLog: '[中断] 実行が中断されました。',
  interruptedDefaultError: '実行が中断されました',
};

// NOTE: `t` defaults to the original Japanese source strings so existing
// callers without i18n context (e.g. the pre-existing test suite) keep
// getting identical output; real usage (useExecutionPolling.ts) passes a
// next-intl translator scoped to `devMode.executionPolling`.
export const defaultPollT: PollTranslate = (key, params) =>
  interpolate(JA_TEMPLATES[key] ?? key, params);

// Workflow phase completion messages keyed by sessionMode, resolved via `t`
// (scoped to `devMode.executionPolling.workflowPhase`).
// NOTE: researcher/planner/reviewer are auto-advancing phases — the orchestrator
// proceeds to the next phase automatically (planner/reviewer also auto-approve
// when the setting is on). The messages must NOT imply a hard manual stop, which
// previously contradicted the actual auto-run ("自動承認なのに実装実行をお願いします").
// NOTE: The researcher run sometimes also produces & auto-approves the plan in
// the same pass, so don't claim "→ plan phase" (which read as a contradiction
// right after "プランは自動承認されました"). Stay neutral about which phase is next.
const WORKFLOW_PHASE_LABEL_KEYS: Record<string, string> = {
  'workflow-researcher': 'workflowPhase.researcher',
  'workflow-planner': 'workflowPhase.planner',
  'workflow-reviewer': 'workflowPhase.reviewer',
  'workflow-implementer': 'workflowPhase.implementer',
  'workflow-verifier': 'workflowPhase.verifier',
};

/**
 * Phases the orchestrator auto-advances after completion. When the just-
 * completed phase is one of these, polling MUST continue so the FE picks
 * up the next phase's execution row instead of stopping at the seam.
 */
const AUTO_ADVANCING_PHASES = new Set<string>([
  'workflow-researcher',
  'workflow-planner',
  'workflow-reviewer',
  'workflow-implementer',
]);

function isAutoAdvancingPhase(sessionMode: string | null | undefined): boolean {
  return !!sessionMode && AUTO_ADVANCING_PHASES.has(sessionMode);
}

/** Terminal task/workflow states — no further phase will run. */
const TERMINAL_TASK_STATUSES = new Set(['done', 'completed', 'failed', 'cancelled', 'archived']);

/**
 * True when the TASK itself has reached a terminal state. A single dev-mode
 * execution can finish the whole workflow (research→…→verify→completed) in one
 * AgentExecution whose sessionMode is an auto-advancing phase; once the task is
 * terminal there is NO next phase, so the poller must finalize the UI instead of
 * waiting forever. Reads the task status/workflowStatus the status endpoint now
 * returns.
 */
function isWorkflowTerminal(data: Record<string, unknown>): boolean {
  const wf = data.workflowStatus as string | null | undefined;
  const ts = data.taskStatus as string | null | undefined;
  return wf === 'completed' || (!!ts && TERMINAL_TASK_STATUSES.has(ts));
}

/**
 * True when the TASK is still actively progressing even though the current
 * execution row completed — e.g. a verify that did NOT finalize the task because
 * it bounced into the self-repair loop (verify → implement → verify). The
 * verifier phase is NOT in AUTO_ADVANCING_PHASES, so without this the poller
 * stopped at the verifier seam and the UI froze at 完了 until a manual reload
 * ("再読込しないとステータスが更新されない"). Bounded: as soon as taskStatus
 * leaves 'in-progress' (→ done/blocked/failed) polling stops on the next tick.
 */
function isTaskActivelyProgressing(data: Record<string, unknown>): boolean {
  return data.taskStatus === 'in-progress' && data.workflowStatus !== 'completed';
}

/**
 * Handle the 'completed' execution status.
 * Returns a state updater function, or null if the update should be skipped.
 *
 * @param data - Raw polling response data / ポーリングレスポンスデータ
 * @param refs - Shared mutable refs / 共有可変ref群
 * @param t - Translator scoped to `devMode.executionPolling`. / `devMode.executionPolling` にスコープした翻訳関数
 * @returns State updater or null / stateアップデータまたはnull
 */
export function handleCompleted(
  data: Record<string, unknown>,
  refs: PollRefs,
  t: PollTranslate = defaultPollT,
): ((prev: ExecutionStreamState) => ExecutionStreamState) | null {
  const isStatusChanged = refs.lastProcessedStatusRef.current !== data.executionStatus;

  if (!isStatusChanged && refs.hasAddedFinalLogRef.current) {
    return null;
  }
  logger.info('Execution completed');
  refs.lastProcessedStatusRef.current = data.executionStatus as string;

  const shouldAddLog = !refs.hasAddedFinalLogRef.current;
  if (shouldAddLog) {
    refs.hasAddedFinalLogRef.current = true;
  }

  const sessionMode = data.sessionMode as string | null;
  // A completed execution counts as auto-advancing ONLY while the task itself
  // is not yet terminal. Once the task is done/completed there is no next phase,
  // so finalize the UI (show 完了 + the PRを開く button) instead of polling on.
  const autoAdvancing =
    !isWorkflowTerminal(data) &&
    (isAutoAdvancingPhase(sessionMode) || isTaskActivelyProgressing(data));
  let completionMessage = `\n${t('completedLog')}\n`;
  if (sessionMode?.startsWith('workflow-')) {
    const phaseKey = WORKFLOW_PHASE_LABEL_KEYS[sessionMode];
    completionMessage =
      '\n' + (phaseKey ? t(phaseKey) : t('workflowPhase.default', { mode: sessionMode })) + '\n';
  }

  // When the whole task has finished AND an auto-PR was created, surface it in
  // the log — the run previously ended at "[調査完了]…次のフェーズへ" with no
  // sign the PR had been opened. Added once (gated by hasAddedFinalLogRef).
  const prUrl = typeof data.prUrl === 'string' ? data.prUrl : null;
  if (isWorkflowTerminal(data) && prUrl) {
    const prNumber = typeof data.prNumber === 'number' ? `#${data.prNumber} ` : '';
    completionMessage += `${t('prCreatedLog', { info: `${prNumber}${prUrl}` })}\n`;
  }

  // PHASE-COMPLETE BUT NOT TASK-COMPLETE: do NOT reset the dedup refs here.
  // Resetting on every 'completed' poll made this handler re-run and re-emit the
  // phase-completion message on EVERY subsequent poll while the same completed
  // execution row persisted (the "[調査完了]…自動で進みます" spam when the next
  // phase hadn't spawned yet). The NEXT phase is detected by the executionId
  // rollover check in executePoll(), which resets these refs when a genuinely
  // new AgentExecution appears — so the same completed phase is logged once.

  return (prev) => ({
    ...prev,
    // Stay "running" between auto-advancing phases so the UI does not
    // flash "完了" between implementer and verifier — UNLESS the task is
    // already terminal (single-execution run that finished everything).
    isRunning: autoAdvancing ? true : false,
    status: autoAdvancing ? 'running' : 'completed',
    waitingForInput: false,
    question: undefined,
    sessionMode: sessionMode || prev.sessionMode,
    // Bump the marker so parent components refetch workflow files /
    // workflow status. Fires for BOTH terminal completion and
    // auto-advancing phase boundaries — both points where the
    // workflowStatus + saved md files have moved on the server.
    phaseAdvanceMarker: (prev.phaseAdvanceMarker ?? 0) + 1,
    logs:
      shouldAddLog && prev.logs.length > 0
        ? trimLogs([...prev.logs, completionMessage])
        : shouldAddLog
          ? [completionMessage]
          : prev.logs,
  });
}

/**
 * Inspect `data.sessionMode` and decide whether the polling loop should
 * keep running after this `completed` row was processed.
 */
export function shouldKeepPollingAfterCompleted(data: Record<string, unknown>): boolean {
  // Keep polling for the next phase ONLY while the task is still in flight. A
  // terminal task (single execution that completed everything) has no next phase.
  // Also keep polling when the task itself is still progressing (e.g. a verify
  // bounce re-running implement→verify) so the UI follows the loop without a
  // manual reload — even though the verifier phase is not auto-advancing.
  return (
    !isWorkflowTerminal(data) &&
    (isAutoAdvancingPhase(data.sessionMode as string | null) || isTaskActivelyProgressing(data))
  );
}
