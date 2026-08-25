/**
 * workflow-tab-selection.test
 *
 * Covers the workflow tab narrowing, in particular that a workflow-disabled
 * task awaiting an intake answer still gets a Q&A tab (task 656 — the question
 * was otherwise unanswerable because no tab rendered at all).
 */
import { describe, it, expect } from 'vitest';
import { selectWorkflowTabs } from './workflow-tab-selection';

const ALL = [{ id: 'research' }, { id: 'question' }, { id: 'plan' }, { id: 'verify' }];
const ids = (tabs: { id: string }[]) => tabs.map((t) => t.id);

describe('selectWorkflowTabs', () => {
  it('hides the Q&A tab when nothing is pending', () => {
    const tabs = selectWorkflowTabs(ALL, { workflowDisabled: false, hasPendingQuestion: false });
    expect(ids(tabs)).toEqual(['research', 'plan', 'verify']);
  });

  it('shows the Q&A tab when a question is pending', () => {
    const tabs = selectWorkflowTabs(ALL, { workflowDisabled: false, hasPendingQuestion: true });
    expect(ids(tabs)).toEqual(['research', 'question', 'plan', 'verify']);
  });

  it('narrows a workflow-disabled task to verify only', () => {
    const tabs = selectWorkflowTabs(ALL, { workflowDisabled: true, hasPendingQuestion: false });
    expect(ids(tabs)).toEqual(['verify']);
  });

  it('keeps the Q&A tab on a workflow-disabled task awaiting an answer', () => {
    const tabs = selectWorkflowTabs(ALL, { workflowDisabled: true, hasPendingQuestion: true });
    expect(ids(tabs)).toEqual(['question', 'verify']);
  });

  // NOTE: 2026-08-25. Disabling a task that had already produced research.md /
  // plan.md hid those tabs even though the files existed — the bar lost its
  // tabs and the panel fell back to an empty verify, which read as the view
  // breaking. The rule is about tabs a disabled task will never FILL.
  it('keeps tabs whose artifact already exists when the workflow is disabled', () => {
    const tabs = selectWorkflowTabs(ALL, {
      workflowDisabled: true,
      hasPendingQuestion: false,
      tabHasContent: { research: true, plan: true, verify: false },
    });
    expect(ids(tabs)).toEqual(['research', 'plan', 'verify']);
  });

  it('still hides the tabs a disabled task never produced', () => {
    const tabs = selectWorkflowTabs(ALL, {
      workflowDisabled: true,
      hasPendingQuestion: false,
      tabHasContent: { research: false, plan: false, verify: false },
    });
    expect(ids(tabs)).toEqual(['verify']);
  });

  it('preserves the original tab order', () => {
    const tabs = selectWorkflowTabs([{ id: 'verify' }, { id: 'question' }], {
      workflowDisabled: true,
      hasPendingQuestion: true,
    });
    expect(ids(tabs)).toEqual(['verify', 'question']);
  });
});
