/**
 * workflow-viewer-utils.test
 *
 * Tab availability per workflow mode: the Q&A tab must be reachable in every
 * mode because the intake gate can pause any task on question.md; visibility
 * without a question is selectWorkflowTabs' job, not the mode filter's.
 */
import { describe, it, expect } from 'vitest';
import { getWorkflowTabs } from './workflow-viewer-utils';
import { selectWorkflowTabs } from './workflow-tab-selection';

const t = ((key: string) => key) as unknown as Parameters<typeof getWorkflowTabs>[1];

describe('getWorkflowTabs', () => {
  it('keeps the Q&A tab in lightweight mode (intake questions ignore the mode)', () => {
    const ids = getWorkflowTabs('lightweight', t).map((tab) => tab.id);
    expect(ids).toEqual(['research', 'question', 'verify']);
  });

  it('lists all tabs in standard and comprehensive modes', () => {
    expect(getWorkflowTabs('standard', t).map((tab) => tab.id)).toEqual([
      'research',
      'question',
      'plan',
      'verify',
    ]);
    expect(getWorkflowTabs('comprehensive', t).map((tab) => tab.id)).toEqual([
      'research',
      'question',
      'plan',
      'verify',
    ]);
  });
});

describe('lightweight Q&A visibility', () => {
  it('hides Q&A until a question exists, then shows it', () => {
    const tabs = getWorkflowTabs('lightweight', t);
    const idle = selectWorkflowTabs(tabs, { workflowDisabled: false, hasPendingQuestion: false });
    expect(idle.map((tab) => tab.id)).toEqual(['research', 'verify']);
    const pending = selectWorkflowTabs(tabs, { workflowDisabled: false, hasPendingQuestion: true });
    expect(pending.map((tab) => tab.id)).toEqual(['research', 'question', 'verify']);
  });
});
