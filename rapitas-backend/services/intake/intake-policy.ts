/**
 * Intake Policy
 *
 * Resolves how the intake gate behaves when a task's spec is still ambiguous
 * after auto-enrichment, and decides the resulting action. Pure/config-only —
 * no DB or filesystem access.
 *
 * Resolution order (highest priority first):
 *   1. Per-task override (future `Task` column — not yet in schema)
 *   2. Env fallback `RAPITAS_INTAKE_ASK_WHEN_AMBIGUOUS`
 *   3. Hardcoded default: `ask` (trial phase — a human is present to clarify)
 */

/** What to do when the spec is ambiguous: pause and ask, or proceed on best-guess. */
export type IntakePolicy = 'ask' | 'best_guess';

/** The concrete action the intake gate should take for the current task. */
export type IntakeAction = 'ready' | 'ask' | 'proceed_low_confidence';

/** Resolved policy plus where it came from (diagnostics). */
export interface ResolvedIntakePolicy {
  policy: IntakePolicy;
  source: 'task' | 'env' | 'default';
}

/** Parse an env flag into an IntakePolicy, or null when unset/unrecognized. */
function envPolicy(): IntakePolicy | null {
  const raw = (process.env.RAPITAS_INTAKE_ASK_WHEN_AMBIGUOUS ?? '').trim().toLowerCase();
  if (raw === '') return null;
  if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return 'ask';
  if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return 'best_guess';
  return null;
}

/**
 * Resolve the ambiguity policy for a task.
 *
 * @param overrides - Optional per-task override (future schema column). / タスク個別の上書き
 * @returns The resolved policy and its source. / 解決済みポリシーとソース
 */
export function resolveIntakePolicy(overrides?: {
  taskPolicy?: IntakePolicy | null;
}): ResolvedIntakePolicy {
  if (overrides?.taskPolicy === 'ask' || overrides?.taskPolicy === 'best_guess') {
    return { policy: overrides.taskPolicy, source: 'task' };
  }
  const fromEnv = envPolicy();
  if (fromEnv) return { policy: fromEnv, source: 'env' };
  // Trial-phase default: ask. Flip the env var to 'best_guess' for unattended runs.
  return { policy: 'ask', source: 'default' };
}

/**
 * Decide the intake action from the (already-computed) inputs. Pure — this is
 * the single decision point the gate and its tests share.
 *
 * @param isAdequate - Whether the spec passed the quality check. / 仕様が十分か
 * @param wasAnswered - Whether the user has ANSWERED a prior intake question. / ユーザーが回答済みか
 * @param policy - The resolved ambiguity policy. / 解決済みポリシー
 * @returns The action to take. / 取るべきアクション
 */
export function decideIntake(
  isAdequate: boolean,
  wasAnswered: boolean,
  policy: IntakePolicy,
): IntakeAction {
  if (isAdequate) return 'ready';
  // Keep asking (stay paused in awaiting_question) until the USER answers — the
  // workflow must NOT proceed on best-guess while a question is unanswered. The
  // orchestrator/reconciler skip awaiting_question tasks, so this pauses rather
  // than loops. Once answered, if the spec is STILL thin we proceed on best-guess
  // (the user's answer is folded in) instead of re-asking forever.
  if (policy === 'ask' && !wasAnswered) return 'ask';
  return 'proceed_low_confidence';
}
