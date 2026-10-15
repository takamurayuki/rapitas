/**
 * probe-metrics-store テスト
 *
 * JSONL ストアの round-trip / ディレクトリ自動生成 / sinceMs フィルタ /
 * 破損行スキップを検証する。RAPITAS_DATA_DIR を一時ディレクトリへ向ける。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendRecord, readRecords, attemptsFilePath } from './probe-metrics-store';
import type { ProbeAttemptRecord } from './probe-metrics.types';

function makeRecord(overrides: Partial<ProbeAttemptRecord> = {}): ProbeAttemptRecord {
  return {
    tsMs: 1_000_000,
    taskId: 673,
    role: 'researcher',
    targetId: 'db',
    outcome: 'success',
    attempts: 1,
    latencyMs: 12,
    errorMessage: null,
    ...overrides,
  };
}

describe('probe-metrics-store', () => {
  let dir: string;
  const prevDataDir = process.env.RAPITAS_DATA_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'probe-metrics-'));
    process.env.RAPITAS_DATA_DIR = dir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  test('append → read の round-trip で全フィールドが保存される', () => {
    const record = makeRecord();
    appendRecord(record);

    const records = readRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(record);
  });

  test('未作成の probe-metrics ディレクトリを自動生成して書き込む', () => {
    expect(existsSync(join(dir, 'probe-metrics'))).toBe(false);
    appendRecord(makeRecord());
    expect(existsSync(attemptsFilePath())).toBe(true);
  });

  test('sinceMs フィルタは tsMs >= sinceMs のレコードのみ返す（境界を含む）', () => {
    appendRecord(makeRecord({ tsMs: 999 }));
    appendRecord(makeRecord({ tsMs: 1000 }));
    appendRecord(makeRecord({ tsMs: 1001 }));

    const records = readRecords(1000);
    expect(records.map((r) => r.tsMs)).toEqual([1000, 1001]);
  });

  test('破損行・不正な形状の行はスキップし残りを返す（throw しない）', () => {
    appendRecord(makeRecord({ tsMs: 1 }));
    appendFileSync(attemptsFilePath(), 'this is not json\n');
    appendFileSync(attemptsFilePath(), `${JSON.stringify({ foo: 'bar' })}\n`);
    appendRecord(makeRecord({ tsMs: 2 }));

    const records = readRecords();
    expect(records.map((r) => r.tsMs)).toEqual([1, 2]);
  });

  test('ファイル未作成なら空配列を返す', () => {
    expect(readRecords()).toEqual([]);
  });
});
