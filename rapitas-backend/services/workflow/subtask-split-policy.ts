/**
 * subtask-split-policy
 *
 * Single source of truth for the RAPITAS_ENABLE_SUBTASK_SPLIT feature flag and
 * the planner-facing directive that keeps instructions consistent with it.
 * Not responsible for creating/splitting subtasks or blocking task creation.
 */

/**
 * Whether automatic subtask splitting on plan save is enabled (default: OFF).
 *
 * Disabled by default after it repeatedly broke runs: it created bogus subtasks
 * from plan section headings (no keyword list can cover them all), and a split
 * parent conflicts with the comprehensive single-agent flow (verify gets blocked
 * by "open" subtasks, auto-commit aborts). The single agent completes the work
 * in one session and commits reliably; progress visibility comes from the plan
 * checklist + live execution log + verify.md. Re-enable (for a future,
 * rebuilt subtask-execution chain) with RAPITAS_ENABLE_SUBTASK_SPLIT=1.
 *
 * @returns true when splitting is enabled / 分割が有効か
 */
export function isSubtaskSplitEnabled(): boolean {
  const v = (process.env.RAPITAS_ENABLE_SUBTASK_SPLIT || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Builds the planner directive that aligns instructions with the split flag.
 *
 * When splitting is DISABLED (default) this returns an explicit prohibition
 * that overrides CLAUDE.md's "Step 2.5 — Subtask Splitting" — without it the
 * planner follows the static project instructions and files child tasks via
 * POST /tasks that the disabled execution chain never runs (real incident:
 * task 541, parent completed with orphaned todo subtasks). When splitting is
 * ENABLED it returns '' so the current Step 2.5 guidance applies unchanged.
 *
 * @param language - Output language for the directive / 指示の出力言語
 * @returns Directive markdown block, or '' when splitting is enabled / 指示文（有効時は空文字列）
 */
export function buildSubtaskSplitDirective(language: 'ja' | 'en' = 'ja'): string {
  if (isSubtaskSplitEnabled()) return '';
  if (language === 'en') {
    return (
      '## Subtask splitting is FORBIDDEN (split execution chain disabled)\n' +
      'Automatic subtask execution is disabled in this configuration (RAPITAS_ENABLE_SUBTASK_SPLIT unset/off). CLAUDE.md\'s "Step 2.5 — Subtask Splitting" does NOT apply to this task.\n' +
      '- **Do NOT create child tasks via POST /tasks (no tasks with parentId).** They would never be auto-executed and leave the parent inconsistent (completed parent + orphaned todo subtasks).\n' +
      '- Even when the plan is large, do not split it — express the full scope as a single plan.md implementation checklist.'
    );
  }
  return (
    '## サブタスク分割の禁止（分割実行チェーンが無効な構成）\n' +
    'この構成ではサブタスクの自動実行が無効化されています（RAPITAS_ENABLE_SUBTASK_SPLIT 未設定/無効）。CLAUDE.md の「Step 2.5 — Subtask Splitting」はこのタスクには適用されません。\n' +
    '- **POST /tasks による子タスク起票（parentId 付きタスクの作成）をしないでください。** 起票しても自動実行されず、親タスクとの不整合（親 completed + サブタスク todo 残骸）を引き起こします。\n' +
    '- 計画の規模が大きい場合でも分割せず、全スコープを単一の plan.md の実装チェックリストとして表現してください。'
  );
}
