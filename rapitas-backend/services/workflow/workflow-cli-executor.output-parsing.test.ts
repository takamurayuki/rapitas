/**
 * workflow-cli-executor.output-parsing.test
 *
 * executeCLIAgent's non-verify output handling: investigation-phase report
 * harvesting (finalMessage/output → extractMarkdownFromOutput → save),
 * the readWorkflowFile → extraction-fallback → validation pipeline for
 * research/plan artifacts, research-assessed complexity application, and the
 * "advance status FORWARD only" rule (never regress a status the HTTP
 * file-save handler already advanced). Verify-phase completion/PR logic is
 * covered separately in workflow-cli-executor.verify.test.ts.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  wf,
  spies,
  resetWfMockState,
  installWorkflowCliExecutorMocks,
} from '../../tests/helpers/workflow-cli-executor-mock-state';
import type { RoleTransition, WorkflowAdvanceResult } from './workflow-types';

installWorkflowCliExecutorMocks();
const { executeCLIAgent } = await import('./workflow-cli-executor');

const workflowDir = join(tmpdir(), 'rapitas-wf-cli-executor-test', 'output-parsing');
const advanceWorkflow = (): Promise<WorkflowAdvanceResult> =>
  Promise.resolve({ success: true, role: 'implementer', status: 'verify_done' });
const getOrCreateDevConfig = (): Promise<{ id: number }> => Promise.resolve({ id: 42 });
const task = { title: 'Investigate the thing', description: 'desc' };
const agentConfig = { id: 1, agentType: 'claude-code', name: 'Agent', modelId: null };

function researchTransition(): RoleTransition {
  return { role: 'researcher', outputFile: 'research', nextStatus: 'research_done' };
}
function planTransition(): RoleTransition {
  return { role: 'planner', outputFile: 'plan', nextStatus: 'plan_created' };
}

async function run(transition: RoleTransition): Promise<WorkflowAdvanceResult> {
  return executeCLIAgent(
    1,
    task,
    agentConfig,
    'system prompt',
    'context',
    transition,
    workflowDir,
    'ja',
    advanceWorkflow,
    getOrCreateDevConfig,
  );
}

describe('executeCLIAgent — investigation-phase report harvesting', () => {
  beforeEach(() => {
    resetWfMockState();
  });

  test('prefers the clean finalMessage over the raw streamed output', async () => {
    wf.executeTaskImpl = async () => ({
      success: true,
      output: 'RAW LOG WITH TOOL DUMPS...',
      finalMessage: 'The clean final report',
    });
    wf.extractMarkdownFromOutputImpl = (raw) =>
      raw === 'The clean final report' ? '# Research\ncleaned' : null;
    wf.readWorkflowFileImpl = async () => '# Research\ncleaned';

    await run(researchTransition());

    const call = spies.writeWorkflowFile.mock.calls[0] as [string, string, string, number];
    expect(call[1]).toBe('research');
    expect(call[2]).toBe('# Research\ncleaned');
    expect(call[3]).toBe(1);
  });

  test('falls back to raw output when finalMessage is empty', async () => {
    wf.executeTaskImpl = async () => ({
      success: true,
      output: 'the raw output',
      finalMessage: '',
    });
    wf.extractMarkdownFromOutputImpl = (raw) =>
      raw === 'the raw output' ? '# Research\nfrom output' : null;
    wf.readWorkflowFileImpl = async () => '# Research\nfrom output';

    await run(researchTransition());

    const call = spies.writeWorkflowFile.mock.calls[0] as [string, string, string, number];
    expect(call[2]).toBe('# Research\nfrom output');
  });

  test('a log-polluted result with no extractable report skips the write entirely', async () => {
    wf.executeTaskImpl = async () => ({
      success: true,
      output: 'garbage log noise',
      finalMessage: '',
    });
    wf.extractMarkdownFromOutputImpl = () => null;
    wf.readWorkflowFileImpl = async () => null;

    const result = await run(researchTransition());

    expect(spies.writeWorkflowFile).not.toHaveBeenCalled();
    // Falls through to the "required file not saved" failure path below.
    expect(result.success).toBe(false);
  });

  test('a writeWorkflowFile failure during harvest is swallowed, not thrown', async () => {
    wf.executeTaskImpl = async () => ({ success: true, output: 'x', finalMessage: 'clean report' });
    wf.extractMarkdownFromOutputImpl = () => '# Research\ncleaned';
    spies.writeWorkflowFile.mockImplementationOnce(() => Promise.reject(new Error('disk full')));
    wf.readWorkflowFileImpl = async () => null;

    // Must not throw despite the harvest write rejecting.
    const result = await run(researchTransition());
    expect(result).toBeDefined();
  });
});

describe('executeCLIAgent — outputFile read / extraction-fallback / validation', () => {
  beforeEach(() => {
    resetWfMockState();
  });

  test('dispatches research content to validateResearch (not validatePlan/validateVerify)', async () => {
    wf.readWorkflowFileImpl = async () => '# Research\n...';

    await run(researchTransition());

    expect(spies.validateResearch).toHaveBeenCalledTimes(1);
    expect(spies.validatePlan).not.toHaveBeenCalled();
    expect(spies.validateVerify).not.toHaveBeenCalled();
  });

  test('dispatches plan content to validatePlan', async () => {
    wf.readWorkflowFileImpl = async () => '# Plan\n...';

    await run(planTransition());

    expect(spies.validatePlan).toHaveBeenCalledTimes(1);
    expect(spies.validateResearch).not.toHaveBeenCalled();
  });

  test('extracts from raw output when the file was never saved directly (>100 chars)', async () => {
    const longOutput = 'x'.repeat(150);
    wf.readWorkflowFileImpl = async () => null;
    wf.executeTaskImpl = async () => ({ success: true, output: longOutput, finalMessage: '' });
    wf.extractMarkdownFromOutputImpl = (raw) =>
      raw === longOutput ? '# Research\nextracted' : null;

    const result = await run(researchTransition());

    expect(spies.writeWorkflowFile).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  test('the >100-char extraction-fallback gate is not retried for short output', async () => {
    wf.readWorkflowFileImpl = async () => null;
    wf.executeTaskImpl = async () => ({ success: true, output: 'too short', finalMessage: '' });

    const result = await run(researchTransition());

    // Called exactly once, by the investigation-harvest step (which has no
    // length gate) — the SEPARATE >100-char extraction-fallback gate (right
    // after readWorkflowFile) must not fire a second attempt for 9 chars.
    expect(spies.extractMarkdownFromOutput).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error).toContain('research.md was not saved');
  });

  test('applies research-assessed complexity only for the research outputFile', async () => {
    wf.readWorkflowFileImpl = async () => '# Research\n## 複雑度評価\nスコア: 42';

    await run(researchTransition());

    expect(spies.applyResearchAssessedComplexity).toHaveBeenCalledTimes(1);
    const [, content] = spies.applyResearchAssessedComplexity.mock.calls[0] as [number, string];
    expect(content).toContain('複雑度評価');
  });

  test('does not apply research complexity for a plan outputFile', async () => {
    wf.readWorkflowFileImpl = async () => '# Plan\n...';

    await run(planTransition());

    expect(spies.applyResearchAssessedComplexity).not.toHaveBeenCalled();
  });
});

describe('executeCLIAgent — status advances FORWARD only', () => {
  beforeEach(() => {
    resetWfMockState();
  });

  test('advances workflowStatus when the phase moves the status forward', async () => {
    wf.readWorkflowFileImpl = async () => '# Research\n...';
    wf.taskWorkflowState = { ...wf.taskWorkflowState!, workflowStatus: 'draft' };

    const result = await run(researchTransition());

    expect(result.status).toBe('research_done');
    const updateCall = spies.taskUpdate.mock.calls.find(
      (c) =>
        (c[0] as { data: { workflowStatus?: string } }).data.workflowStatus === 'research_done',
    );
    expect(updateCall).toBeDefined();
    expect(spies.recordTransition).toHaveBeenCalled();
  });

  test('never regresses a status the HTTP handler already advanced past', async () => {
    wf.readWorkflowFileImpl = async () => '# Research\n...';
    // Already at plan_created (rank 2) — ahead of research_done (rank 1).
    wf.taskWorkflowState = { ...wf.taskWorkflowState!, workflowStatus: 'plan_created' };

    const result = await run(researchTransition());

    expect(result.status).toBe('plan_created');
    const regressCall = spies.taskUpdate.mock.calls.find(
      (c) =>
        (c[0] as { data: { workflowStatus?: string } }).data.workflowStatus === 'research_done',
    );
    expect(regressCall).toBeUndefined();
  });

  test('auto-approves the plan and reports plan_approved when settings allow it', async () => {
    wf.readWorkflowFileImpl = async () => '# Plan\n...';
    wf.taskWorkflowState = { ...wf.taskWorkflowState!, workflowStatus: 'draft' };
    wf.maybeAutoApprovePlanImpl = async () => ({
      newStatus: 'plan_approved',
      autoApproved: true,
      reason: 'auto',
    });

    const result = await run(planTransition());

    expect(result.status).toBe('plan_approved');
  });
});
