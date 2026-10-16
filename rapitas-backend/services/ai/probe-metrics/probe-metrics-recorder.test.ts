/**
 * probe-metrics-recorder テスト
 *
 * never-throw 保証（store 例外を握り潰す）/ テスト環境ガード
 * （RAPITAS_DATA_DIR 未指定時は記録しない）を検証する。
 * NOTE: mock.module はプロセスグローバル — store の実装は本ファイル内では
 * 常にモックされ、実ファイルへは書き込まない。
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { ProbeAttemptRecord } from './probe-metrics.types';

const appendRecordMock = mock((_record: ProbeAttemptRecord) => {});
mock.module('./probe-metrics-store', () => ({
  appendRecord: appendRecordMock,
  readRecords: mock(() => []),
  attemptsFilePath: mock(() => '/tmp/attempts.jsonl'),
}));

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

const { recordProbeAttempt } = await import('./probe-metrics-recorder');

const RECORD: ProbeAttemptRecord = {
  tsMs: 123_456,
  taskId: 673,
  role: 'researcher',
  targetId: 'db',
  outcome: 'success',
  attempts: 1,
  latencyMs: 12,
  errorMessage: null,
};

describe('recordProbeAttempt', () => {
  const prevDataDir = process.env.RAPITAS_DATA_DIR;

  beforeEach(() => {
    appendRecordMock.mockClear();
    appendRecordMock.mockImplementation(() => {});
    process.env.RAPITAS_DATA_DIR = '/tmp/probe-metrics-test';
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = prevDataDir;
  });

  test('record がそのまま store へ渡される', () => {
    recordProbeAttempt(RECORD);

    expect(appendRecordMock).toHaveBeenCalledTimes(1);
    expect(appendRecordMock.mock.calls[0][0]).toEqual(RECORD);
  });

  test('store が例外を投げても throw しない（never throw）', () => {
    appendRecordMock.mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => recordProbeAttempt(RECORD)).not.toThrow();
  });

  test('NODE_ENV=test かつ RAPITAS_DATA_DIR 未指定なら記録しない（テスト混入ガード）', () => {
    delete process.env.RAPITAS_DATA_DIR;

    recordProbeAttempt(RECORD);

    expect(appendRecordMock).not.toHaveBeenCalled();
  });
});
