/**
 * workflowBlockedCause
 *
 * Maps a `WorkflowTransition.cause` code to its i18n key under the
 * `workflow.statusIndicator.blockedCauses` namespace, shared by every UI
 * surface that explains why a task is blocked (TaskWorkflowSection's detail
 * page fetch, TaskCard's batched list-endpoint field). NOT responsible for
 * fetching the cause itself.
 */

/**
 * `WorkflowTransition.cause` codes that co-occur with `task.status === 'blocked'`
 * writes (grepped from services/workflow — see the recordTransition call sites
 * in workflow-orchestrator.ts, workflow-cli-executor.ts and
 * subtask-completion-handler.ts). Maps each to a translation key under
 * `workflow.statusIndicator.blockedCauses`; unrecognized/unset causes fall back
 * to the generic hint.
 */
export const BLOCKED_CAUSE_I18N_KEYS: Record<string, string> = {
  plan_invalid_replan_exhausted: 'planInvalidReplanExhausted',
  verify_pr_not_created: 'verifyPrNotCreated',
  verify_validation_failed: 'verifyValidationFailed',
  verify_no_changes: 'verifyNoChanges',
  subtask_failed: 'subtaskFailed',
};

/** Stop records and the metadata key naming their checks. */
const CHECK_NAME_KEYS: Record<string, string> = {
  verification_stopped: 'failedChecks',
  verification_unverifiable_hold: 'unverifiableChecks',
};

/**
 * Follow-up rows written after a stop. They would hide which check stopped the task.
 * NOTE: Keep in step with the backend's services/task/blocked-cause.ts.
 */
const FOLLOW_UP_CAUSES = new Set([
  'verify_pr_not_created',
  'verification_gate_failed',
  'verification_gate_repeat_hold',
]);

/** The slice of a workflow transition needed to explain a block. */
export interface BlockedCauseTransition {
  cause?: string | null;
  metadata?: unknown;
}

/**
 * Cause to show for a blocked task, in the same `<cause>:<check,check>` form the
 * list endpoint returns.
 *
 * @param transitions - Transitions, oldest first / 古い順の遷移
 * @returns Cause code, or null when there is none / 原因コード
 */
export function blockedCauseFromTransitions(transitions: BlockedCauseTransition[]): string | null {
  for (let i = transitions.length - 1; i >= 0; i--) {
    const { cause, metadata } = transitions[i];
    if (cause && Object.hasOwn(CHECK_NAME_KEYS, cause)) {
      const names = (metadata as Record<string, unknown> | null | undefined)?.[
        CHECK_NAME_KEYS[cause]
      ];
      const checks = Array.isArray(names) ? names.filter((n) => typeof n === 'string') : [];
      return checks.length ? `${cause}:${checks.join(',')}` : cause;
    }
    if (!cause || !FOLLOW_UP_CAUSES.has(cause)) break;
  }
  return transitions[transitions.length - 1]?.cause ?? null;
}

/**
 * Resolve a blocked-cause code to its localized message, using `t` from
 * `useTranslations('workflow')`.
 *
 * @param t - Translation function scoped to the `workflow` namespace / `workflow` 名前空間の翻訳関数
 * @param cause - Raw `WorkflowTransition.cause` code, or null/undefined when unknown / 生の原因コード
 * @returns Localized message, or `undefined` when no cause is available (caller should fall back to the generic hint) / ローカライズ済みメッセージ
 */
export function resolveBlockedCauseLabel(
  t: (key: string, values?: Record<string, string>) => string,
  cause: string | null | undefined,
): string | undefined {
  if (!cause) return undefined;
  const i18nKey = BLOCKED_CAUSE_I18N_KEYS[cause];
  if (i18nKey) return t(`statusIndicator.blockedCauses.${i18nKey}`);
  // Only stop records carry check names; other codes may contain ':' themselves.
  const [code, checks] = cause.split(':');
  const shown =
    checks && Object.hasOwn(CHECK_NAME_KEYS, code)
      ? `${code}: ${checks.split(',').join(', ')}`
      : cause;
  return t('statusIndicator.blockedCauseUnknown', { cause: shown });
}
