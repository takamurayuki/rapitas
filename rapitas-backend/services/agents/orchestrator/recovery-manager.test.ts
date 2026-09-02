/**
 * recovery-manager ユニットテスト
 *
 * このファイルはロジックを持たない再エクスポート barrel。
 * stale-execution-recovery.ts / execution-resume.ts は agentFactory・Prisma・
 * config/database まで連なる重い依存チェーンを引き込むため、両モジュールを
 * mock.module で丸ごと差し替え、barrel が正しいシンボルへ転送しているかだけを
 * 検証する。
 */
import { describe, expect, test, mock } from 'bun:test';

const recoverStaleExecutionsMock = mock(async () => ({
  recoveredExecutions: 1,
  updatedTasks: 1,
  updatedSessions: 1,
  interruptedExecutionIds: [1],
  reconciledBlockedSessions: 0,
  prunedWorktreePointers: 0,
}));
const getInterruptedExecutionsMock = mock(async () => []);

mock.module('./stale-execution-recovery', () => ({
  recoverStaleExecutions: recoverStaleExecutionsMock,
  getInterruptedExecutions: getInterruptedExecutionsMock,
  // NOTE: full mirror — the barrel (via agent-orchestrator importers) also
  // pulls these exports; a partial mock breaks with "export not found".
  sweepDeadLeaseExecutions: mock(async () => 0),
  startExecutionLeaseSweep: mock(() => {}),
}));

const resumeInterruptedExecutionMock = mock(async () => ({
  success: true,
  output: 'resumed',
  artifacts: [],
  commits: [],
  executionTimeMs: 0,
  waitingForInput: false,
}));
const buildResumePromptMock = mock(() => 'resume prompt');
class MockResumeLockConflictError extends Error {
  constructor(public readonly taskId: number) {
    super(`Task ${taskId} already has an active execution — refusing duplicate resume`);
    this.name = 'ResumeLockConflictError';
  }
}

mock.module('./execution-resume', () => ({
  resumeInterruptedExecution: resumeInterruptedExecutionMock,
  buildResumePrompt: buildResumePromptMock,
  ResumeLockConflictError: MockResumeLockConflictError,
}));

const recoveryManager = await import('./recovery-manager');

describe('recovery-manager barrel', () => {
  test('recoverStaleExecutions は stale-execution-recovery の実装をそのまま転送する', async () => {
    const result = await recoveryManager.recoverStaleExecutions({} as never);

    expect(recoverStaleExecutionsMock).toHaveBeenCalledTimes(1);
    expect(result.recoveredExecutions).toBe(1);
  });

  test('getInterruptedExecutions は stale-execution-recovery の実装をそのまま転送する', async () => {
    const result = await recoveryManager.getInterruptedExecutions({} as never);

    expect(getInterruptedExecutionsMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  test('resumeInterruptedExecution は execution-resume の実装をそのまま転送する', async () => {
    const result = await recoveryManager.resumeInterruptedExecution({} as never, 1);

    expect(resumeInterruptedExecutionMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  test('buildResumePrompt は execution-resume の実装をそのまま転送する', () => {
    const result = recoveryManager.buildResumePrompt({} as never, 'last', 'summary', null);

    expect(buildResumePromptMock).toHaveBeenCalledTimes(1);
    expect(result).toBe('resume prompt');
  });

  test('barrel が想定する7シンボルのみを公開している', () => {
    expect(Object.keys(recoveryManager).sort()).toEqual(
      [
        'buildResumePrompt',
        'getInterruptedExecutions',
        'recoverStaleExecutions',
        'resumeInterruptedExecution',
        // Lease sweep (2026-08 architecture review): dead-run detection by
        // heartbeat age, exported alongside the startup recovery pass.
        'sweepDeadLeaseExecutions',
        'startExecutionLeaseSweep',
        // Task 840: benign-skip marker for a per-task execution-lock conflict.
        'ResumeLockConflictError',
      ].sort(),
    );
  });
});
