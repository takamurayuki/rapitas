/**
 * miss-record — one self-verify miss per job and gate (task 1602)
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  fakeEvents,
  queryHooks,
  resetFakeTimeline,
  seedJob,
  appendEventMock,
} from './timeline-fake.fixture';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }),
}));

const { recordSelfVerifyMiss, recordRepairMisses, findPassingJob } = await import('./miss-record');

const misses = () => fakeEvents.filter((e) => e.eventType === 'self_verify_miss');

beforeEach(() => resetFakeTimeline());

describe('recordSelfVerifyMiss', () => {
  test('after a passing job it stores runId, SHA, gate, reason, files and kind', async () => {
    seedJob(9, 'run-1', { revision: 'abc123', changedFiles: ['rapitas-backend/x.ts'] });
    const ok = await recordSelfVerifyMiss({
      taskId: 9,
      gate: 'ci:Lint Code',
      checkName: 'Lint Code',
      reason: 'CI failed',
    });
    expect(ok).toBe(true);
    expect(misses()).toHaveLength(1);
    expect(misses()[0]!.correlationId).toBe('self-verify-miss-9');
    expect(misses()[0]!.payload).toEqual({
      taskId: 9,
      runId: 'run-1',
      revision: 'abc123',
      gate: 'ci:Lint Code',
      gateFamily: 'ci',
      checkName: 'Lint Code',
      kind: 'mechanical',
      reasonSummary: 'CI failed',
      files: ['rapitas-backend/x.ts'],
      dedupKey: 'run-1|ci:Lint Code',
    });
  });

  test('no self-verify job means nothing to compare and nothing is stored', async () => {
    expect(await recordSelfVerifyMiss({ taskId: 9, gate: 'verify', reason: 'r' })).toBe(false);
    expect(misses()).toHaveLength(0);
  });

  test('a latest job that failed or was unverifiable is not a pass', async () => {
    seedJob(9, 'run-ok');
    seedJob(9, 'run-red', { ok: false });
    expect(await recordSelfVerifyMiss({ taskId: 9, gate: 'verify', reason: 'r' })).toBe(false);
    seedJob(9, 'run-unv', { ok: true, unverifiable: true });
    expect(await recordSelfVerifyMiss({ taskId: 9, gate: 'verify', reason: 'r' })).toBe(false);
    expect(misses()).toHaveLength(0);
  });

  test('a crashed (status failed) newer job is skipped for the newest completed one', async () => {
    seedJob(9, 'run-ok');
    seedJob(9, 'run-crash', { status: 'failed', ok: undefined });
    expect((await findPassingJob(9))?.runId).toBe('run-ok');
  });

  test('the same failure reported twice is stored once', async () => {
    seedJob(9, 'run-1');
    await recordSelfVerifyMiss({ taskId: 9, gate: 'verify', reason: 'r' });
    expect(await recordSelfVerifyMiss({ taskId: 9, gate: 'verify', reason: 'r again' })).toBe(
      false,
    );
    expect(misses()).toHaveLength(1);
  });

  test('a job finishing after the lookup does not change the recorded runId', async () => {
    seedJob(9, 'run-old');
    queryHooks.push((type) => {
      if (
        type === 'verification_job_finished' &&
        !fakeEvents.some((e) => e.payload.runId === 'run-new')
      )
        seedJob(9, 'run-new');
    });
    await recordSelfVerifyMiss({ taskId: 9, gate: 'verify', reason: 'r' });
    expect(misses()[0]!.payload.runId).toBe('run-old');
  });

  test('a storage failure is swallowed and reported as not recorded', async () => {
    seedJob(9, 'run-1');
    appendEventMock.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    expect(await recordSelfVerifyMiss({ taskId: 9, gate: 'verify', reason: 'r' })).toBe(false);
  });
});

describe('recordRepairMisses', () => {
  test('a post-commit gate failure files one presave miss per failing check', async () => {
    seedJob(4, 'run-4');
    const n = await recordRepairMisses(
      4,
      '自動検証に失敗しました（自動検証: lint=NG(1) / tamper=NG(1)）',
    );
    expect(n).toBe(2);
    expect(misses().map((e) => e.payload.gate)).toEqual(['presave:lint', 'presave:tamper']);
  });

  test('a diff-review rejection takes its files from the findings', async () => {
    seedJob(4, 'run-4', { changedFiles: ['rapitas-backend/a.ts', 'rapitas-backend/b.ts'] });
    await recordRepairMisses(4, '差分レビュー不合格: x', {
      findings: [{ evidence: 'rapitas-backend/b.ts:7' }],
    });
    expect(misses()[0]!.payload).toMatchObject({
      gate: 'diff_review',
      kind: 'judgment',
      files: ['rapitas-backend/b.ts'],
    });
  });
});
