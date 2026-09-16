/**
 * supervision-write-spool テスト
 *
 * JSONL スプールの round-trip / 破損行の扱い / removeFromSpool の
 * ファイル未作成時(ENOENT)の安全な早期returnを検証する。RAPITAS_DATA_DIR を
 * 一時ディレクトリへ向ける。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { spoolFilePath, spoolRecord, readSpool, removeFromSpool } from './supervision-write-spool';

interface TestPayload {
  taskId: number;
}

function makeRecord(id: string, taskId = 1) {
  return { id, kind: 'intervention' as const, spooledAt: '2026-01-01T00:00:00.000Z', data: { taskId } };
}

describe('supervision-write-spool', () => {
  let dir: string;
  const prevDataDir = process.env.RAPITAS_DATA_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'supervision-write-spool-'));
    process.env.RAPITAS_DATA_DIR = dir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  test('removeFromSpool on a file that was never created is a safe no-op', () => {
    // The fix under test: removeFromSpool must not throw when the spool file
    // does not exist (previously guarded by an existsSync() check with a
    // TOCTOU gap — CodeQL js/file-system-race).
    expect(() => removeFromSpool(new Set(['nonexistent']))).not.toThrow();
  });

  test('spoolRecord then readSpool round-trips the record', () => {
    spoolRecord(makeRecord('a', 42));
    const { records, corruptLines } = readSpool<TestPayload>();
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('a');
    expect(records[0]?.data.taskId).toBe(42);
    expect(corruptLines).toBe(0);
  });

  test('removeFromSpool deletes only the matching id, keeping the rest', () => {
    spoolRecord(makeRecord('a'));
    spoolRecord(makeRecord('b'));
    spoolRecord(makeRecord('c'));

    removeFromSpool(new Set(['b']));

    const { records } = readSpool<TestPayload>();
    expect(records.map((r) => r.id).sort()).toEqual(['a', 'c']);
  });

  test('removeFromSpool with an empty id set leaves the spool untouched', () => {
    spoolRecord(makeRecord('a'));
    removeFromSpool(new Set());
    const { records } = readSpool<TestPayload>();
    expect(records).toHaveLength(1);
  });

  test('readSpool counts corrupt lines without dropping the good ones', () => {
    const path = spoolFilePath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(makeRecord('a'))}\nnot json\n`, 'utf-8');

    const { records, corruptLines } = readSpool<TestPayload>();
    expect(records).toHaveLength(1);
    expect(corruptLines).toBe(1);
  });

  test('removeFromSpool leaves corrupt lines in place', () => {
    const path = spoolFilePath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(makeRecord('a'))}\nnot json\n`, 'utf-8');

    removeFromSpool(new Set(['a']));

    const { records, corruptLines } = readSpool<TestPayload>();
    expect(records).toHaveLength(0);
    expect(corruptLines).toBe(1);
  });
});
