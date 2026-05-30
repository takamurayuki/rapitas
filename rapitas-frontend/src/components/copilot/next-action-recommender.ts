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
  /** Task status in frontend form: 'todo' | 'in-progress' | 'done'. */
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
export type NextActionIcon = 'analyze' | 'split' | 'play' | 'check' | 'estimate' | 'reflect';

/**
 * A single recommended next action. Carries EITHER `actionType` (one-click
 * copilot action) OR `prompt` (a message sent to the copilot chat), never both.
 */
export interface RecommendedAction {
  id: string;
  label: string;
  reason: string;
  /** Copilot action to execute, when this is an action recommendation. */
  actionType?: NextActionType;
  params?: Record<string, unknown>;
  /** Chat prompt to send, when this is a conversational recommendation. */
  prompt?: string;
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
        label: '振り返りをする',
        reason: 'うまくいった点・改善点・次に活かせる学びをAIがまとめます',
        prompt:
          'このタスクの振り返りをしてください。うまくいった点、改善点、次に活かせる学びを簡潔にまとめてください。',
        icon: 'reflect',
        tone: 'primary',
      },
    ];
  }

  const out: RecommendedAction[] = [];
  const allSubtasksDone = ctx.subtaskTotal > 0 && ctx.subtaskDone === ctx.subtaskTotal;
  const isComplex =
    ctx.complexityScore !== null && ctx.complexityScore > COMPLEXITY_NEEDS_SUBTASKS;
  // Whether the primary action already drives the task toward subtasks, so the
  // secondary "split" suggestion would be redundant.
  let primaryCoversSubtasks = false;

  // --- Primary action by status -------------------------------------------
  if (ctx.status === 'in-progress' && allSubtasksDone) {
    out.push({
      id: 'complete',
      label: 'タスクを完了にする',
      reason: `サブタスク ${ctx.subtaskDone}/${ctx.subtaskTotal} がすべて完了しています`,
      actionType: 'update_status',
      params: { status: 'done' },
      icon: 'check',
      tone: 'primary',
    });
  } else if (ctx.status === 'in-progress') {
    if (ctx.canRunAgent) {
      out.push({
        id: 'continue',
        label: 'エージェントで実行する',
        reason: '進行中です。エージェントで次のフェーズを実行できます',
        actionType: 'execute',
        icon: 'play',
        tone: 'primary',
      });
    } else {
      out.push({
        id: 'complete-manual',
        label: 'タスクを完了にする',
        reason: '実装が終わったらタスクをクローズしましょう',
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
        label: 'AIで分析する',
        reason: '着手前にAIが進め方とサブタスクを提案します',
        actionType: 'analyze',
        icon: 'analyze',
        tone: 'primary',
      });
      primaryCoversSubtasks = true;
    } else if (ctx.canRunAgent) {
      out.push({
        id: 'execute',
        label: 'エージェントで実行する',
        reason: 'サブタスクの準備ができています。エージェントに着手させましょう',
        actionType: 'execute',
        icon: 'play',
        tone: 'primary',
      });
    } else {
      out.push({
        id: 'start',
        label: '着手する',
        reason: '準備OK。ステータスを進行中にします',
        actionType: 'update_status',
        params: { status: 'in_progress' },
        icon: 'play',
        tone: 'primary',
      });
    }
  }

  // --- Secondary suggestions ----------------------------------------------
  // Split a complex, not-yet-broken-down task (unless the primary already does).
  if (!primaryCoversSubtasks && ctx.subtaskTotal === 0 && isComplex) {
    out.push({
      id: 'split',
      label: 'サブタスクに分解する',
      reason: `複雑度 ${Math.round(ctx.complexityScore as number)}。分割して進めると安全です`,
      actionType: 'create_subtasks',
      icon: 'split',
      tone: 'normal',
    });
  }

  // Estimate is always useful when missing.
  if (ctx.estimatedHours === null) {
    out.push({
      id: 'estimate',
      label: '工数を見積もる',
      reason: '工数が未設定です。見積もると計画が立てやすくなります',
      actionType: 'update_estimate',
      icon: 'estimate',
      tone: 'normal',
    });
  }

  return out.slice(0, MAX_RECOMMENDATIONS);
}
