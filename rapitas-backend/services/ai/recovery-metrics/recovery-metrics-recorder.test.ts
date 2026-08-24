/**
 * recovery-metrics-recorder テスト
 *
 * never-throw 保証（store 例外を握り潰す）/ nowMs→tsMs マップと既定値 /
 * テスト環境ガード（RAPITAS_DATA_DIR 未指定時は記録しない）を検証する。
 * NOTE: mock.module はプロセスグローバル — store の実装は本ファイル内では
 * 常にモックされ、実ファイルへは書き込まない。
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { RecoveryAttemptRecord } from './recovery-metrics.types';

const appendRecordMock = mock((_record: RecoveryAttemptRecord) => {});
mock.module('./recovery-metrics-store', () => ({
  appendRecord: appendRecordMock,
  readRecords: mock(() => []),
  attemptsFilePath: mock(() => '/tmp/attempts.jsonl'),
}));

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

const { recordRecoveryAttempt } = await import('./recovery-metrics-recorder');

const INPUT = {
  taskId: 641,
  phase: 'planner',
  errorType: 'quota' as const,
  fromProvider: 'openai',
  fromModel: 'gpt-5',
  strategy: 'reroute' as const,
  outcome: 'failure' as const,
};

describe('recordRecoveryAttempt', () => {
  const prevDataDir = process.env.RAPITAS_DATA_DIR;

  beforeEach(() => {
    appendRecordMock.mockClear();
    appendRecordMock.mockImplementation(() => {});
    // NOTE: NODE_ENV=test 下では RAPITAS_DATA_DIR が明示されている場合のみ
    // 記録される（テスト混入ガード）。本スイートでは store がモックのため
    // 実書込は発生しない。
    process.env.RAPITAS_DATA_DIR = '/tmp/recovery-metrics-test';
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = prevDataDir;
  });

  test('nowMs が tsMs に採用され、省略フィールドは既定値で埋まる', () => {
    recordRecoveryAttempt(INPUT, 123_456);

    expect(appendRecordMock).toHaveBeenCalledTimes(1);
    expect(appendRecordMock.mock.calls[0][0]).toEqual({
      tsMs: 123_456,
      taskId: 641,
      phase: 'planner',
      errorType: 'quota',
      fromProvider: 'openai',
      fromModel: 'gpt-5',
      toProvider: null,
      strategy: 'reroute',
      outcome: 'failure',
      latencyMs: 0,
      costUsd: null,
      failureReason: null,
    });
  });

  test('明示された任意フィールドはそのまま保存される', () => {
    recordRecoveryAttempt(
      { ...INPUT, toProvider: 'claude', latencyMs: 42, costUsd: 0.01, failureReason: 'rate_limit' },
      1,
    );

    expect(appendRecordMock.mock.calls[0][0]).toMatchObject({
      toProvider: 'claude',
      latencyMs: 42,
      costUsd: 0.01,
      failureReason: 'rate_limit',
    });
  });

  test('store が例外を投げても throw しない（never throw）', () => {
    appendRecordMock.mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => recordRecoveryAttempt(INPUT, 1)).not.toThrow();
  });

  test('NODE_ENV=test かつ RAPITAS_DATA_DIR 未指定なら記録しない（テスト混入ガード）', () => {
    delete process.env.RAPITAS_DATA_DIR;

    recordRecoveryAttempt(INPUT, 1);

    expect(appendRecordMock).not.toHaveBeenCalled();
  });
});
