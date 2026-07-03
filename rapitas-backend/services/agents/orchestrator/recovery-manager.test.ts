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

mock.module('./execution-resume', () => ({
  resumeInterruptedExecution: resumeInterruptedExecutionMock,
  buildResumePrompt: buildResumePromptMock,
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

  test('barrel が想定する4シンボルのみを公開している', () => {
    expect(Object.keys(recoveryManager).sort()).toEqual(
      [
        'buildResumePrompt',
        'getInterruptedExecutions',
        'recoverStaleExecutions',
        'resumeInterruptedExecution',
      ].sort(),
    );
  });
});
