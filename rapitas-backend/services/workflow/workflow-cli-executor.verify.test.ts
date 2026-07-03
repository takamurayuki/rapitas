/**
 * workflow-cli-executor.verify.test
 *
 * executeCLIAgent's verify-phase completion gating: hard validation failures
 * block (durable write + transition), the completion gate refuses to
 * complete a task with no real diff and no explicit justification, and
 * completion always requires a confirmed PR — with the "no diff, already
 * implemented" exception that completes WITHOUT a PR when gh reports nothing
 * to land. Worktree resolution and non-verify output handling are covered in
 * the sibling split files.
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

const workflowDir = join(tmpdir(), 'rapitas-wf-cli-executor-test', 'verify');
const advanceWorkflow = (): Promise<WorkflowAdvanceResult> =>
  Promise.resolve({ success: true, role: 'implementer', status: 'verify_done' });
const getOrCreateDevConfig = (): Promise<{ id: number }> => Promise.resolve({ id: 42 });
const task = { title: 'Verify the thing', description: 'desc' };
const agentConfig = { id: 1, agentType: 'claude-code', name: 'Agent', modelId: null };

function verifyTransition(): RoleTransition {
  return { role: 'verifier', outputFile: 'verify', nextStatus: 'completed' };
}

async function run(): Promise<WorkflowAdvanceResult> {
  return executeCLIAgent(
    1,
    task,
    agentConfig,
    'system prompt',
    'context',
    verifyTransition(),
    workflowDir,
    'ja',
    advanceWorkflow,
    getOrCreateDevConfig,
  );
}

function taskUpdateCalls(): Array<{ data: Record<string, unknown> }> {
  return spies.taskUpdate.mock.calls.map((c) => c[0] as { data: Record<string, unknown> });
}

function recordedCauses(): string[] {
  return spies.recordTransition.mock.calls.map((c) => (c[0] as { cause: string }).cause);
}

describe('executeCLIAgent — verify phase', () => {
  beforeEach(() => {
    resetWfMockState();
    wf.readWorkflowFileImpl = async () => '# Verify\nAll checks passed.';
    wf.taskWorkflowState = { ...wf.taskWorkflowState!, workflowStatus: 'in_progress' };
  });

  test('already completed by the HTTP handler — never re-touched', async () => {
    wf.taskWorkflowState = { ...wf.taskWorkflowState!, workflowStatus: 'completed' };

    const result = await run();

    expect(result.status).toBe('completed');
    expect(spies.evaluateCompletionGate).not.toHaveBeenCalled();
    expect(spies.taskUpdate).not.toHaveBeenCalled();
  });

  test('hard validation failure blocks durably instead of completing', async () => {
    wf.validateVerify = {
      ok: false,
      missingSections: ['テスト結果'],
      severity: 90,
      summary: 'missing sections',
    };

    const result = await run();

    expect(result.status).toBe('in_progress');
    expect(spies.writeBlockedStatusDurable).toHaveBeenCalledTimes(1);
    expect(recordedCauses()).toContain('verify_validation_failed');
    expect(spies.evaluateCompletionGate).not.toHaveBeenCalled();
  });

  test('a soft validation miss (low severity) still proceeds to the completion gate', async () => {
    wf.validateVerify = {
      ok: false,
      missingSections: ['minor'],
      severity: 20,
      summary: 'minor miss',
    };

    await run();

    expect(spies.evaluateCompletionGate).toHaveBeenCalledTimes(1);
  });

  test('no code changes and no justification blocks instead of completing', async () => {
    wf.evaluateCompletionGateImpl = async () => ({
      allow: false,
      reason: 'no_diff_no_justification',
    });

    const result = await run();

    expect(result.status).toBe('in_progress');
    const blocked = taskUpdateCalls().find((c) => c.data.status === 'blocked');
    expect(blocked).toBeDefined();
    expect(recordedCauses()).toContain('verify_no_changes');
    expect(spies.performAutoCommitAndPR).not.toHaveBeenCalled();
  });

  test('completes immediately when a PR is already linked (no auto-commit/PR call needed)', async () => {
    wf.linkedPrRow = { id: 7 };

    const result = await run();

    expect(result.status).toBe('completed');
    expect(spies.performAutoCommitAndPR).not.toHaveBeenCalled();
    const completed = taskUpdateCalls().find((c) => c.data.workflowStatus === 'completed');
    expect(completed).toBeDefined();
    expect(completed?.data.status).toBe('done');
    expect(recordedCauses()).toContain('verify_passed');
  });

  test('completes after a successful auto-commit + PR when none existed yet', async () => {
    wf.performAutoCommitAndPRImpl = async () => ({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      autoPRResult: { success: true, prUrl: 'https://x/1', prNumber: 1 },
    });

    const result = await run();

    expect(spies.performAutoCommitAndPR).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('completed');
    expect(recordedCauses()).toContain('verify_passed');
  });

  test('completes without a PR when auto-commit/PR was not requested at all', async () => {
    wf.performAutoCommitAndPRImpl = async () => ({
      requested: { autoCommit: false, autoCreatePR: false, autoMergePR: false },
    });

    const result = await run();

    expect(result.status).toBe('completed');
  });

  test('"no commits between" PR failure completes WITHOUT a PR (already-implemented no-op)', async () => {
    wf.performAutoCommitAndPRImpl = async () => ({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      autoPRResult: { success: false, error: 'No commits between main and feature/x' },
    });

    const result = await run();

    expect(result.status).toBe('completed');
    const completed = taskUpdateCalls().find((c) => c.data.workflowStatus === 'completed');
    expect(completed).toBeDefined();
    expect(recordedCauses()).toContain('verify_no_change_confirmed');
  });

  test('a genuine PR-creation failure blocks — completion always requires a PR', async () => {
    wf.performAutoCommitAndPRImpl = async () => ({
      requested: { autoCommit: true, autoCreatePR: true, autoMergePR: false },
      autoPRResult: { success: false, error: 'gh: permission denied' },
    });

    const result = await run();

    expect(result.status).toBe('in_progress');
    const blocked = taskUpdateCalls().find((c) => c.data.status === 'blocked');
    expect(blocked).toBeDefined();
    expect(recordedCauses()).toContain('verify_pr_not_created');
  });

  test('a throwing performAutoCommitAndPR is treated as PR-not-created (blocked), not a crash', async () => {
    wf.performAutoCommitAndPRImpl = async () => {
      throw new Error('unexpected auto-commit crash');
    };

    const result = await run();

    expect(result.status).toBe('in_progress');
    expect(recordedCauses()).toContain('verify_pr_not_created');
  });
});
