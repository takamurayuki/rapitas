/**
 * workflow-cli-executor.harvest-critic.test
 *
 * #1303: every research/plan save in production went through the epilogue's
 * harvest (writeWorkflowFile), never the PUT route that runs the phase critic,
 * so the critic had judged nothing in weeks with 45 completed tasks. These
 * tests pin that a harvested research.md / plan.md is judged by the same gate,
 * and that a rejection is reflected in the phase result.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  wf,
  resetWfMockState,
  installWorkflowCliExecutorMocks,
} from '../../tests/helpers/workflow-cli-executor-mock-state';
import type { RoleTransition, WorkflowAdvanceResult } from './workflow-types';

installWorkflowCliExecutorMocks();

let gateOutcome: {
  newStatus?: string;
  criticRejection: { phase: string; rolledBackTo: string; reasons: string[] } | null;
} = { criticRejection: null };
const runPhaseCriticGate = mock(async (p: { newStatus?: string }) => ({
  ...gateOutcome,
  newStatus: gateOutcome.newStatus ?? p.newStatus,
}));
mock.module('../../routes/workflow/handlers/file-save/critic-gate', () => ({ runPhaseCriticGate }));

const { executeCLIAgent } = await import('./workflow-cli-executor');

const advanceWorkflow = (): Promise<WorkflowAdvanceResult> =>
  Promise.resolve({ success: true, role: 'implementer', status: 'verify_done' });
const run = (transition: RoleTransition) =>
  executeCLIAgent(
    1,
    { title: 't', description: 'd' },
    { id: 1, agentType: 'claude-code', name: 'Agent', modelId: null },
    'system',
    'context',
    transition,
    'ja',
    advanceWorkflow,
    () => Promise.resolve({ id: 42 }),
  );

beforeEach(() => {
  resetWfMockState();
  runPhaseCriticGate.mockClear();
  gateOutcome = { criticRejection: null };
});

describe('harvested research/plan go through the phase critic (#1303)', () => {
  test.each([
    [{ role: 'researcher', outputFile: 'research', nextStatus: 'research_done' }, '# Research'],
    [{ role: 'planner', outputFile: 'plan', nextStatus: 'plan_created' }, '# Plan'],
  ] as const)('judges a harvested %o', async (transition, content) => {
    wf.readWorkflowFileImpl = async () => content;
    await run(transition as RoleTransition);
    expect(runPhaseCriticGate).toHaveBeenCalledTimes(1);
    expect(runPhaseCriticGate.mock.calls[0][0]).toMatchObject({
      taskId: 1,
      fileType: transition.outputFile,
      newStatus: transition.nextStatus,
      savedContent: content,
    });
  });

  test('a rejection rolls the phase result back to the regeneration status', async () => {
    wf.readWorkflowFileImpl = async () => '# Research';
    gateOutcome = {
      newStatus: 'draft',
      criticRejection: { phase: 'research', rolledBackTo: 'draft', reasons: ['thin'] },
    };
    const result = await run({
      role: 'researcher',
      outputFile: 'research',
      nextStatus: 'research_done',
    });
    expect(result.status).toBe('draft');
  });

  test('a status the HTTP save already advanced is not judged twice', async () => {
    wf.readWorkflowFileImpl = async () => '# Research';
    wf.taskWorkflowState = { ...wf.taskWorkflowState, workflowStatus: 'research_done' };
    await run({ role: 'researcher', outputFile: 'research', nextStatus: 'research_done' });
    expect(runPhaseCriticGate).not.toHaveBeenCalled();
  });
});
