/**
 * quick-nav-sections
 *
 * Which jump targets the task detail header offers.
 *
 * Split out of `TaskDetailContent` because the list is a claim about another
 * file: every id here must be an id that `TaskDetailViewBody` actually
 * renders, and two of them exist only under the same conditions that file
 * uses. That was a comment asking to be kept in step; as a function it can be
 * held in step by a test instead.
 *
 * Not responsible for drawing anything — see `TaskDetailQuickNav`.
 */
import { Bot, GitBranch, Info, ListTodo } from 'lucide-react';
import type { QuickNavSection } from './TaskDetailQuickNav';

export interface QuickNavInputs {
  /** True when the execution card is rendered — it is the chip's target. */
  showExecutionSection: boolean;
  /** True for a development theme, which is what shows the workflow card. */
  isDevelopmentTheme: boolean;
  labels: {
    detail: string;
    execution: string;
    workflow: string;
    subtasks: string;
  };
}

/**
 * Build the jump targets for a task, in the order they appear on the page.
 *
 * @param inputs - Which sections exist, and their labels / 存在する節とラベル
 * @returns The chips to show / 表示するチップ
 */
export function buildQuickNavSections({
  showExecutionSection,
  isDevelopmentTheme,
  labels,
}: QuickNavInputs): QuickNavSection[] {
  return [
    { id: 'td-info', label: labels.detail, icon: Info },

    // This chip was `{ id: 'td-ai', label: 'AI' }` and pointed at the
    // assistant chat, which is ラピ's now. It points at the execution card
    // instead and takes that card's own label and glyph — the panel header
    // there is a `Bot` too, so the chip and its destination finally read as
    // the same thing.
    //
    // Conditional, unlike the chat it replaces: `td-execution` is only
    // rendered when the panel is shown and the theme has a working directory,
    // and a chip that jumps nowhere is worse than no chip.
    ...(showExecutionSection ? [{ id: 'td-execution', label: labels.execution, icon: Bot }] : []),

    ...(isDevelopmentTheme ? [{ id: 'td-workflow', label: labels.workflow, icon: GitBranch }] : []),

    { id: 'td-subtasks', label: labels.subtasks, icon: ListTodo },
  ];
}
