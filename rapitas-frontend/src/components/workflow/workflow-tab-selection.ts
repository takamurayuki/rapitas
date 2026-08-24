/**
 * workflow-tab-selection
 *
 * Pure helper deciding which workflow tabs are worth showing for a task. No
 * React / side effects. Does not decide which tab is ACTIVE — see useWorkflowViewer.
 */

/** Minimal shape needed to filter a tab list (the real tabs carry labels/icons too). */
export interface WorkflowTabLike {
  id: string;
}

/** Inputs that narrow the tab list. */
export interface WorkflowTabSelectionOptions {
  /**
   * The task skips the multi-phase workflow: one agent implements directly
   * (see instruction-builder.ts), so research.md / plan.md never exist.
   */
  workflowDisabled: boolean;
  /** A live question, a saved question.md, or a workflow paused on an answer. */
  hasPendingQuestion: boolean;
}

/**
 * Narrow the workflow tabs to the ones that can hold content for this task.
 *
 * The Q&A tab appears only when a question actually exists (agents ask rarely,
 * so a permanently-empty tab is noise), and it is deliberately EXEMPT from the
 * workflow-disabled narrowing: the intake quality gate pauses a task on
 * question.md BEFORE any agent runs, so a workflow-disabled task can still be
 * awaiting an answer. Folding it into the verify-only filter removed the tab
 * entirely and left that question unanswerable from the UI.
 *
 * @param allTabs - Every tab defined for the workflow mode. / モードの全タブ
 * @param options - Narrowing inputs. / 絞り込み条件
 * @returns The tabs to render, in their original order. / 表示するタブ
 */
export function selectWorkflowTabs<T extends WorkflowTabLike>(
  allTabs: T[],
  { workflowDisabled, hasPendingQuestion }: WorkflowTabSelectionOptions,
): T[] {
  return allTabs.filter((t) =>
    t.id === 'question' ? hasPendingQuestion : !workflowDisabled || t.id === 'verify',
  );
}
