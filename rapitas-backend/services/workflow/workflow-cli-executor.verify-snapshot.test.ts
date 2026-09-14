/**
 * workflow-cli-executor.verify-snapshot.test
 *
 * executeCLIAgent's wiring of the task-917 verify-phase snapshot protection:
 * only verifier/auto_verifier roles trigger takeVerifySnapshot/
 * reconcileVerifySnapshot, reconcile still runs when the CLI process throws
 * (crash/timeout), and an unrecoverable reconcile on either the "file
 * not saved" path (workflow-cli-executor-epilogue.ts) or the normal verify
 * gate path (workflow-cli-executor-verify-gate.ts) notifies and never lets
 * the phase report success. verify-phase-snapshot.ts's own git logic is
 * covered in verify-phase-snapshot.test.ts (real git) — this file mocks it
 * to isolate the executor's CALL wiring (受入基準2, plan.md C2).
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  wf,
  spies,
  resetWfMockState,
  installWorkflowCliExecutorMocks,
} from '../../tests/helpers/workflow-cli-executor-mock-state';
import type { RoleTransition, WorkflowAdvanceResult } from './workflow-types';

type ReconcileResultLike =
  | { status: 'clean' }
  | { status: 'restored'; restoredFiles: string[] }
  | { status: 'unrecoverable'; reason: string };

let takeSnapshotImpl: (
  worktreePath: string,
  taskId: number,
) => Promise<{ tagName: string; sha: string } | null> = async () => ({
  tagName: 'verify-snapshot/task-1-1700000000000',
  sha: 'deadbeef',
});
let reconcileImpl: (
  worktreePath: string,
  tagName: string,
) => Promise<ReconcileResultLike> = async () => ({ status: 'clean' });

const takeSnapshotMock = mock((worktreePath: string, taskId: number) =>
  takeSnapshotImpl(worktreePath, taskId),
);
const reconcileMock = mock((worktreePath: string, tagName: string) =>
  reconcileImpl(worktreePath, tagName),
);
const closeGateMock = mock(async () => 'plan_approved' as WorkflowAdvanceResult['status']);
const notifyMock = mock(async () => {});

mock.module('./verify-phase-snapshot', () => ({
  takeVerifySnapshot: takeSnapshotMock,
  reconcileVerifySnapshot: reconcileMock,
  closeGateForUnrecoverableSnapshot: closeGateMock,
  notifyVerifySnapshotRestoreFailed: notifyMock,
  VERIFY_SNAPSHOT_TAG_PREFIX: 'verify-snapshot/task-',
  VERIFY_SNAPSHOT_RESTORE_FAILED_CAUSE: 'VERIFY_SNAPSHOT_RESTORE_FAILED',
}));

installWorkflowCliExecutorMocks();
const { executeCLIAgent } = await import('./workflow-cli-executor');

const advanceWorkflow = (): Promise<WorkflowAdvanceResult> =>
  Promise.resolve({ success: true, role: 'implementer', status: 'verify_done' });
const getOrCreateDevConfig = (): Promise<{ id: number }> => Promise.resolve({ id: 42 });
const task = { title: 'Verify the thing', description: 'desc' };
const agentConfig = { id: 1, agentType: 'claude-code', name: 'Agent', modelId: null };

function transitionFor(role: RoleTransition['role']): RoleTransition {
  return role === 'implementer'
    ? { role, outputFile: null, nextStatus: 'in_progress' }
    : { role, outputFile: 'verify', nextStatus: 'completed' };
}

async function run(role: RoleTransition['role']): Promise<WorkflowAdvanceResult> {
  return executeCLIAgent(
    1,
    task,
    agentConfig,
    'system prompt',
    'context',
    transitionFor(role),
    'ja',
    advanceWorkflow,
    getOrCreateDevConfig,
  );
}

beforeEach(() => {
  resetWfMockState();
  wf.taskWorkflowState!.workflowStatus = 'in_progress';
  takeSnapshotImpl = async () => ({
    tagName: 'verify-snapshot/task-1-1700000000000',
    sha: 'deadbeef',
  });
  reconcileImpl = async () => ({ status: 'clean' });
  takeSnapshotMock.mockClear();
  reconcileMock.mockClear();
  closeGateMock.mockClear();
  notifyMock.mockClear();
});

describe('executeCLIAgent — verify-phase snapshot wiring (task 917)', () => {
  test('verifier role takes a snapshot before executeTask and reconciles after', async () => {
    await run('verifier');

    expect(takeSnapshotMock).toHaveBeenCalledTimes(1);
    expect(takeSnapshotMock.mock.calls[0]![1]).toBe(1); // taskId
    expect(reconcileMock).toHaveBeenCalledTimes(1);
    expect(reconcileMock.mock.calls[0]![1]).toBe('verify-snapshot/task-1-1700000000000');
  });

  test('auto_verifier role also takes a snapshot (both verify roles protected)', async () => {
    await run('auto_verifier');

    expect(takeSnapshotMock).toHaveBeenCalledTimes(1);
    expect(reconcileMock).toHaveBeenCalledTimes(1);
  });

  test('implementer role never triggers a snapshot (no regression)', async () => {
    await run('implementer');

    expect(takeSnapshotMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  test('a thrown/timeout CLI execution still reconciles before the error propagates', async () => {
    wf.executeTaskImpl = async () => {
      throw new Error('simulated timeout kill');
    };
    reconcileImpl = async () => ({ status: 'unrecoverable', reason: 'git diff failed' });

    await expect(run('verifier')).rejects.toThrow('simulated timeout kill');

    expect(takeSnapshotMock).toHaveBeenCalledTimes(1);
    expect(reconcileMock).toHaveBeenCalledTimes(1);
    // The exception path owns the notification (epilogue never runs on a throw).
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0]![1]).toBe('git diff failed');
  });

  test('a thrown CLI execution with a clean reconcile does not notify', async () => {
    wf.executeTaskImpl = async () => {
      throw new Error('boom');
    };
    reconcileImpl = async () => ({ status: 'clean' });

    await expect(run('verifier')).rejects.toThrow('boom');

    expect(reconcileMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  test('unrecoverable reconcile on the "verify.md not saved" path closes the gate via the epilogue branch', async () => {
    // Default readWorkflowFileImpl returns null and the agent's short output
    // is below the stdout-extraction threshold, so the epilogue takes its
    // "file not saved" branch — reached without ever calling resolveVerifyPhaseStatus.
    reconcileImpl = async () => ({ status: 'unrecoverable', reason: 'tag unresolved' });

    const result = await run('verifier');

    expect(closeGateMock).toHaveBeenCalledTimes(1);
    expect(closeGateMock.mock.calls[0]![0]).toMatchObject({ taskId: 1, reason: 'tag unresolved' });
    expect(result.success).toBe(false);
    expect(result.status).toBe('plan_approved');
  });

  test('unrecoverable reconcile on the normal verify-gate path (verify.md present) also closes the gate', async () => {
    wf.readWorkflowFileImpl = async () => '# 検証結果\n\n## 検証結果サマリ\n\n判定: OK\n';
    reconcileImpl = async () => ({ status: 'unrecoverable', reason: 'checkout failed' });

    const result = await run('verifier');

    expect(closeGateMock).toHaveBeenCalledTimes(1);
    expect(closeGateMock.mock.calls[0]![0]).toMatchObject({ taskId: 1, reason: 'checkout failed' });
    expect(result.status).toBe('plan_approved');
    // The verify-gate branch owns the notification here, not the executor's catch path.
    expect(spies.performAutoCommitAndPR).not.toHaveBeenCalled();
  });

  test('a restored (auto-recovered) reconcile does not close the gate', async () => {
    reconcileImpl = async () => ({ status: 'restored', restoredFiles: ['a.ts'] });

    await run('verifier');

    expect(closeGateMock).not.toHaveBeenCalled();
  });
});
