/**
 * next-action-recommender
 *
 * Pure, rule-based "what should I do next" suggestions for a task, derived from
 * its current state. No network or LLM — deterministic and unit-testable. Each
 * recommendation maps to an existing copilot action so the UI can execute it in
 * one click. Does NOT render anything; see NextActionRecommendations.tsx.
 */

/** Copilot action a recommendation triggers (subset reused by the panel). */
export type NextActionType =
  | 'analyze'
  | 'create_subtasks'
  | 'execute'
  | 'update_status'
  | 'update_estimate';

/** Task state the recommender reasons over. */
export interface NextActionContext {
  /**
   * Task status. The `Status` type only names 'todo' | 'in-progress' |
   * 'done', but the backend also sends 'blocked' and 'failed' (see
   * TaskWorkflowSection's isBlocked cast) — both are handled explicitly
   * below, not left to fall through the 'todo'/'in-progress' branches.
   */
  status: string;
  /** Total subtasks. */
  subtaskTotal: number;
  /** Subtasks in the 'done' state. */
  subtaskDone: number;
  /** Auto-assigned complexity score (0-100), or null if not scored. */
  complexityScore: number | null;
  /** Estimated hours, or null when unset. */
  estimatedHours: number | null;
  /** True when the task can actually run an agent (dev theme + working dir). */
  canRunAgent: boolean;
}

/** Icon key resolved to a concrete lucide icon by the view. */
export type NextActionIcon =
  | 'analyze'
  | 'split'
  | 'play'
  | 'check'
  | 'estimate'
  | 'reflect'
  | 'alert';

/**
 * A single recommended next action. Carries EITHER `actionType` (one-click
 * copilot action) OR `prompt` (a message sent to the copilot chat), never both.
 *
 * NOTE: `labelKey` / `reasonKey` are message keys under the
 * `copilot.nextActionRecommendations` i18n namespace (not raw text) — this
 * module is pure/non-React and has no `useTranslations` access, so the view
 * (NextActionRecommendations.tsx) resolves them. `reasonParams` carries the
 * ICU interpolation values for reasons that embed numbers (e.g. subtask counts).
 */
export interface RecommendedAction {
  id: string;
  labelKey: string;
  reasonKey: string;
  /** ICU interpolation values for `reasonKey` (next-intl's TranslationValues shape). */
  reasonParams?: Record<string, string | number | Date>;
  /** Copilot action to execute, when this is an action recommendation. */
  actionType?: NextActionType;
  params?: Record<string, unknown>;
  /** Chat prompt to send, when this is a conversational recommendation. */
  prompt?: string;
  /** Runs the grounded retrospective (artifacts → learnings → knowledge OS). */
  runRetrospective?: boolean;
  icon: NextActionIcon;
  tone: 'primary' | 'normal';
}

/** Complexity above this benefits from being split into subtasks first. */
const COMPLEXITY_NEEDS_SUBTASKS = 35;

/** Max recommendations surfaced at once — keep the panel focused. */
const MAX_RECOMMENDATIONS = 3;

/**
 * Computes the recommended next actions for a task, primary action first.
 *
 * @param ctx - Current task state / 現在のタスク状態
 * @returns Up to three recommended actions (empty when the task is done) / 推奨アクション（最大3件、完了タスクは空）
 */
export function getNextActions(ctx: NextActionContext): RecommendedAction[] {
  // Completed task → offer a knowledge-building retrospective (chat prompt).
  if (ctx.status === 'done') {
    return [
      {
        id: 'reflect',
        labelKey: 'actions.reflect.label',
        reasonKey: 'actions.reflect.reason',
        runRetrospective: true,
        icon: 'reflect',
        tone: 'primary',
      },
    ];
  }

  const out: RecommendedAction[] = [];
  const allSubtasksDone = ctx.subtaskTotal > 0 && ctx.subtaskDone === ctx.subtaskTotal;
  const isComplex = ctx.complexityScore !== null && ctx.complexityScore > COMPLEXITY_NEEDS_SUBTASKS;
  // Whether the primary action already drives the task toward subtasks, so the
  // secondary "split" suggestion would be redundant.
  let primaryCoversSubtasks = false;

  // --- Primary action by status -------------------------------------------
  // blocked/failed fell through every branch below (none of them matched
  // 'blocked'/'failed'), so a stuck task silently got the generic secondary
  // suggestions (split/estimate) as if it were healthy — exactly the
  // "next action doesn't match reality" mismatch this recommender exists to
  // avoid. Both now surface what's actually going on instead.
  if (ctx.status === 'blocked') {
    out.push({
      id: 'blocked',
      labelKey: 'actions.blocked.label',
      reasonKey: 'actions.blocked.reason',
      // Matches copilot-intent-responder's blocked_reason pattern
      // (/なぜ.*ブロック/), so this answers instantly from the DB instead of
      // costing an LLM call.
      prompt: 'なぜブロックされているか教えて',
      icon: 'alert',
      tone: 'primary',
    });
  } else if (ctx.status === 'failed') {
    if (ctx.canRunAgent) {
      out.push({
        id: 'retry',
        labelKey: 'actions.retry.label',
        reasonKey: 'actions.retry.reason',
        actionType: 'execute',
        icon: 'alert',
        tone: 'primary',
      });
    } else {
      out.push({
        id: 'failed-manual',
        labelKey: 'actions.failedManual.label',
        reasonKey: 'actions.failedManual.reason',
        prompt: '失敗の原因を教えて',
        icon: 'alert',
        tone: 'primary',
      });
    }
  } else if (ctx.status === 'in-progress' && allSubtasksDone) {
    out.push({
      id: 'complete',
      labelKey: 'actions.complete.label',
      reasonKey: 'actions.complete.reason',
      reasonParams: { done: ctx.subtaskDone, total: ctx.subtaskTotal },
      actionType: 'update_status',
      params: { status: 'done' },
      icon: 'check',
      tone: 'primary',
    });
  } else if (ctx.status === 'in-progress') {
    if (ctx.canRunAgent) {
      out.push({
        id: 'continue',
        labelKey: 'actions.continue.label',
        reasonKey: 'actions.continue.reason',
        actionType: 'execute',
        icon: 'play',
        tone: 'primary',
      });
    } else {
      out.push({
        id: 'complete-manual',
        labelKey: 'actions.completeManual.label',
        reasonKey: 'actions.completeManual.reason',
        actionType: 'update_status',
        params: { status: 'done' },
        icon: 'check',
        tone: 'primary',
      });
    }
  } else if (ctx.status === 'todo') {
    if (ctx.canRunAgent && ctx.subtaskTotal === 0) {
      out.push({
        id: 'analyze',
        labelKey: 'actions.analyze.label',
        reasonKey: 'actions.analyze.reason',
        actionType: 'analyze',
        icon: 'analyze',
        tone: 'primary',
      });
      primaryCoversSubtasks = true;
    } else if (ctx.canRunAgent) {
      out.push({
        id: 'execute',
        labelKey: 'actions.execute.label',
        reasonKey: 'actions.execute.reason',
        actionType: 'execute',
        icon: 'play',
        tone: 'primary',
      });
    } else {
      out.push({
        id: 'start',
        labelKey: 'actions.start.label',
        reasonKey: 'actions.start.reason',
        actionType: 'update_status',
        params: { status: 'in-progress' },
        icon: 'play',
        tone: 'primary',
      });
    }
  }

  // --- Secondary suggestions ----------------------------------------------
  // Only for a task actually moving forward normally — a blocked/failed task
  // needs its primary action addressed first; housekeeping nudges like
  // "add an estimate" alongside "why is this blocked?" read as the
  // recommender not noticing the task is stuck.
  const isMovingForward = ctx.status === 'todo' || ctx.status === 'in-progress';

  // Split a complex, not-yet-broken-down task (unless the primary already does).
  if (isMovingForward && !primaryCoversSubtasks && ctx.subtaskTotal === 0 && isComplex) {
    out.push({
      id: 'split',
      labelKey: 'actions.split.label',
      reasonKey: 'actions.split.reason',
      reasonParams: { score: Math.round(ctx.complexityScore as number) },
      actionType: 'create_subtasks',
      icon: 'split',
      tone: 'normal',
    });
  }

  // Estimate is useful when missing, for a task still actively moving.
  if (isMovingForward && ctx.estimatedHours === null) {
    out.push({
      id: 'estimate',
      labelKey: 'actions.estimate.label',
      reasonKey: 'actions.estimate.reason',
      actionType: 'update_estimate',
      icon: 'estimate',
      tone: 'normal',
    });
  }

  return out.slice(0, MAX_RECOMMENDATIONS);
}
