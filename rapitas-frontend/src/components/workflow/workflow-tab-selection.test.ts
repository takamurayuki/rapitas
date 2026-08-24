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

  it('preserves the original tab order', () => {
    const tabs = selectWorkflowTabs([{ id: 'verify' }, { id: 'question' }], {
      workflowDisabled: true,
      hasPendingQuestion: true,
    });
    expect(ids(tabs)).toEqual(['verify', 'question']);
  });
});
