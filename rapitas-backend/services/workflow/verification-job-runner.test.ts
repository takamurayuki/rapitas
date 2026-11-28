/**
 * verification-job-runner.test
 *
 * Unit tests for the fast/slow split: beginVerificationRun records a start
 * event and returns a runId without running the gate; runVerificationGateAndRecord
 * runs the gate and records completed/failed/unverifiable finish events.
 * Also covers the self-verification activity markers (task 1582). The
 * computeVerificationCacheKey real-git regressions now live in
 * verification-cache-key.test.ts next to the function.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const runGitCommandMock = mock(async (args: string[]) => {
  if (args[0] === 'rev-parse') return 'head-1';
  if (args[0] === 'diff') return '';
  if (args[0] === 'ls-files') return '';
  return '';
});
mock.module('../github/git-exec', () => ({ runGitCommand: runGitCommandMock }));

const findUniqueMock = mock(async () => ({
  title: 'Feature',
  description: '',
  acceptanceCriteria: null,
}));
mock.module('../../config', () => ({
  prisma: { task: { findUnique: findUniqueMock } },
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}) }),
}));

const runAutomatedVerificationMock = mock(
  async (): Promise<{ ok: boolean; summary: string; checks: unknown[] }> => ({
    ok: true,
    summary: 'ok',
    checks: [],
  }),
);
const renderVerificationMarkdownMock = mock(() => '# 自動検証\nok');
mock.module('../agents/verification/automated-verifier', () => ({
  runAutomatedVerification: runAutomatedVerificationMock,
  renderVerificationMarkdown: renderVerificationMarkdownMock,
  looksLikeBugFixTask: () => false,
  requiresTestsForTask: () => false,
}));

const readWorkflowFileMock = mock(async (): Promise<string | null> => null);
mock.module('./workflow-file-utils', () => ({ readWorkflowFile: readWorkflowFileMock }));

const resolvePreferredBaseBranchMock = mock(async (): Promise<string | null> => 'develop');
mock.module('../task/task-resolver', () => ({
  resolvePreferredBaseBranch: resolvePreferredBaseBranchMock,
}));

const recordJobStartMock = mock(async () => {});
const recordJobFinishMock = mock(async () => {});
mock.module('./verification-job-store', () => ({
  recordJobStart: recordJobStartMock,
  recordJobFinish: recordJobFinishMock,
}));

const markStartedMock = mock((_ref: unknown) => {});
const markFinishedMock = mock((_ref: unknown) => {});
mock.module('./self-verification-activity', () => ({
  getActivityStore: () => ({ markStarted: markStartedMock, markFinished: markFinishedMock }),
}));

const { beginVerificationRun, runVerificationGateAndRecord } =
  await import('./verification-job-runner');

beforeEach(() => {
  runGitCommandMock.mockClear();
  findUniqueMock.mockClear();
  runAutomatedVerificationMock.mockClear();
  renderVerificationMarkdownMock.mockClear();
  readWorkflowFileMock.mockClear();
  resolvePreferredBaseBranchMock.mockClear();
  recordJobStartMock.mockClear();
  recordJobFinishMock.mockClear();
  markStartedMock.mockClear();
  markFinishedMock.mockClear();
  runGitCommandMock.mockImplementation(async (args: string[]) => {
    if (args[0] === 'rev-parse') return 'head-1';
    if (args[0] === 'diff') return '';
    if (args[0] === 'ls-files') return '';
    return '';
  });
  runAutomatedVerificationMock.mockImplementation(async () => ({
    ok: true,
    summary: 'ok',
    checks: [],
  }));
});

describe('beginVerificationRun', () => {
  it('runId を生成し recordJobStart を正しい引数で1回呼ぶ', async () => {
    const result = await beginVerificationRun(1, 'C:/wt/task-1');
    expect(typeof result.runId).toBe('string');
    expect(result.runId.length).toBeGreaterThan(0);
    expect(recordJobStartMock).toHaveBeenCalledTimes(1);
    expect(recordJobStartMock).toHaveBeenCalledWith(1, result.runId, expect.any(String), {
      operation: 'POST /workflow/tasks/1/run-verification',
      worktreePath: 'C:/wt/task-1',
      revision: 'head-1',
    });
    // The gate itself must NOT run in the fast path.
    expect(runAutomatedVerificationMock).not.toHaveBeenCalled();
  });
});

describe('runVerificationGateAndRecord', () => {
  it('正常系で recordJobFinish に status:completed, ok:true を渡す', async () => {
    const { cacheInputsBefore, keyBefore } = await beginVerificationRun(2, 'C:/wt/task-2');
    await runVerificationGateAndRecord(2, 'run-x', 'C:/wt/task-2', cacheInputsBefore, keyBefore);
    expect(recordJobFinishMock).toHaveBeenCalledTimes(1);
    const [taskId, runId, outcome] = recordJobFinishMock.mock.calls[0] as [
      number,
      string,
      { status: string; ok?: boolean; unverifiable?: boolean },
    ];
    expect(taskId).toBe(2);
    expect(runId).toBe('run-x');
    expect(outcome).toMatchObject({ status: 'completed', ok: true, unverifiable: false });
  });

  it('runAutomatedVerification が例外を投げた場合 status:failed で記録する', async () => {
    runAutomatedVerificationMock.mockImplementation(async () => {
      throw new Error('gate crashed');
    });
    const { cacheInputsBefore, keyBefore } = await beginVerificationRun(3, 'C:/wt/task-3');
    await runVerificationGateAndRecord(3, 'run-y', 'C:/wt/task-3', cacheInputsBefore, keyBefore);
    expect(recordJobFinishMock).toHaveBeenCalledTimes(1);
    const [, , outcome] = recordJobFinishMock.mock.calls[0] as [
      number,
      string,
      { status: string; error?: string },
    ];
    expect(outcome).toMatchObject({ status: 'failed', error: 'gate crashed' });
  });

  it('実行中に keyBefore と keyAfter が変わると unverifiable:true, ok:false で記録する', async () => {
    let diffCall = 0;
    runGitCommandMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return 'head-1';
      if (args[0] === 'diff') {
        diffCall += 1;
        return diffCall === 1 ? 'diff-before' : 'diff-after';
      }
      if (args[0] === 'ls-files') return '';
      return '';
    });
    const { cacheInputsBefore, keyBefore } = await beginVerificationRun(4, 'C:/wt/task-4');
    await runVerificationGateAndRecord(4, 'run-z', 'C:/wt/task-4', cacheInputsBefore, keyBefore);
    expect(recordJobFinishMock).toHaveBeenCalledTimes(1);
    const [, , outcome] = recordJobFinishMock.mock.calls[0] as [
      number,
      string,
      { status: string; ok?: boolean; unverifiable?: boolean },
    ];
    expect(outcome).toMatchObject({ status: 'completed', ok: false, unverifiable: true });
  });
});

describe('self-verification activity markers (task 1582)', () => {
  it('beginVerificationRun records the run as running for its worktree', async () => {
    const { runId } = await beginVerificationRun(5, 'C:/wt/task-5');
    expect(markStartedMock).toHaveBeenCalledTimes(1);
    expect(markStartedMock).toHaveBeenCalledWith({
      runId,
      taskId: 5,
      worktreePath: 'C:/wt/task-5',
    });
  });

  it('a completed run is marked finished with the verdict and the passed/failed check counts', async () => {
    runAutomatedVerificationMock.mockImplementation(async () => ({
      ok: false,
      summary: 'ng',
      checks: [
        { ran: true, ok: true },
        { ran: true, ok: true },
        { ran: true, ok: false },
        { ran: false, ok: true },
      ],
    }));
    const { cacheInputsBefore, keyBefore } = await beginVerificationRun(5, 'C:/wt/task-5');
    await runVerificationGateAndRecord(5, 'run-a', 'C:/wt/task-5', cacheInputsBefore, keyBefore);
    expect(markFinishedMock).toHaveBeenCalledTimes(1);
    expect(markFinishedMock).toHaveBeenCalledWith({
      runId: 'run-a',
      taskId: 5,
      worktreePath: 'C:/wt/task-5',
      ok: false,
      unverifiable: false,
      passed: 2,
      failed: 1,
    });
  });

  it('an input change mid-run is marked finished as unverifiable', async () => {
    let diffCall = 0;
    runGitCommandMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'diff') return `d${diffCall++}`;
      return args[0] === 'rev-parse' ? 'head-1' : '';
    });
    const { cacheInputsBefore, keyBefore } = await beginVerificationRun(5, 'C:/wt/task-5');
    await runVerificationGateAndRecord(5, 'run-b', 'C:/wt/task-5', cacheInputsBefore, keyBefore);
    expect(markFinishedMock.mock.calls[0][0]).toMatchObject({ ok: false, unverifiable: true });
  });

  it('a crashed gate is still marked finished, so watchdogs stop waiting', async () => {
    runAutomatedVerificationMock.mockImplementation(async () => {
      throw new Error('boom');
    });
    const { cacheInputsBefore, keyBefore } = await beginVerificationRun(5, 'C:/wt/task-5');
    await runVerificationGateAndRecord(5, 'run-c', 'C:/wt/task-5', cacheInputsBefore, keyBefore);
    expect(markFinishedMock.mock.calls[0][0]).toMatchObject({
      runId: 'run-c',
      ok: false,
      unverifiable: true,
    });
  });

  it('a marker write failure never fails the verification job', async () => {
    markFinishedMock.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const { cacheInputsBefore, keyBefore } = await beginVerificationRun(5, 'C:/wt/task-5');
    await expect(
      runVerificationGateAndRecord(5, 'run-d', 'C:/wt/task-5', cacheInputsBefore, keyBefore),
    ).resolves.toBeUndefined();
    expect(recordJobFinishMock).toHaveBeenCalledTimes(1);
  });
});

describe('beginVerificationRun (タスク行が取得できない場合)', () => {
  it('タスク行が存在しない(null)場合は例外を投げ、recordJobStart を呼ばない', async () => {
    findUniqueMock.mockImplementationOnce(async () => null);
    await expect(beginVerificationRun(13, 'C:/wt/task-13')).rejects.toThrow();
    expect(recordJobStartMock).not.toHaveBeenCalled();
  });

  it('タスク行取得が失敗(throw)した場合も例外を投げる', async () => {
    findUniqueMock.mockImplementationOnce(async () => {
      throw new Error('database unavailable');
    });
    await expect(beginVerificationRun(14, 'C:/wt/task-14')).rejects.toThrow();
    expect(recordJobStartMock).not.toHaveBeenCalled();
  });
});
