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
  return i18nKey
    ? t(`statusIndicator.blockedCauses.${i18nKey}`)
    : t('statusIndicator.blockedCauseUnknown', { cause });
}
