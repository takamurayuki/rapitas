/**
 * execution-file-logger/log-file-manager ユニットテスト
 *
 * listExecutionLogFiles / getExecutionLogFile / cleanupOldLogs を、実際の
 * 一時ディレクトリ上に固定ファイルを配置して検証する（fsモックなし）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { listExecutionLogFiles, getExecutionLogFile, cleanupOldLogs } from './log-file-manager';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'rapitas-log-file-manager-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes a fixture log file and sets its mtime for deterministic ordering. */
function writeLog(filename: string, mtimeOffsetSeconds: number): void {
  const filePath = path.join(dir, filename);
  writeFileSync(filePath, 'log content');
  const t = new Date(Date.now() + mtimeOffsetSeconds * 1000);
  utimesSync(filePath, t, t);
}

describe('listExecutionLogFiles', () => {
  test('returns an empty array when the directory does not exist', async () => {
    const result = await listExecutionLogFiles(path.join(dir, 'does-not-exist'));
    expect(result).toEqual([]);
  });

  test('returns an empty array for an empty directory', async () => {
    expect(await listExecutionLogFiles(dir)).toEqual([]);
  });

  test('only includes files matching the exec-*.log pattern', async () => {
    writeLog('exec-1-abc.log', 0);
    writeFileSync(path.join(dir, 'not-a-log.txt'), 'ignore me');
    writeFileSync(path.join(dir, 'exec-missing-extension'), 'ignore me too');

    const result = await listExecutionLogFiles(dir);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('exec-1-abc.log');
  });

  test('sorts results newest-first by mtime', async () => {
    writeLog('exec-1-old.log', -100);
    writeLog('exec-2-new.log', 0);
    writeLog('exec-3-mid.log', -50);

    const result = await listExecutionLogFiles(dir);
    expect(result.map((f) => f.filename)).toEqual([
      'exec-2-new.log',
      'exec-3-mid.log',
      'exec-1-old.log',
    ]);
  });

  test('returns filename, path, size, and mtime metadata', async () => {
    writeLog('exec-1-abc.log', 0);
    const [meta] = await listExecutionLogFiles(dir);
    expect(meta.filename).toBe('exec-1-abc.log');
    expect(meta.path).toBe(path.join(dir, 'exec-1-abc.log'));
    expect(meta.size).toBeGreaterThan(0);
    expect(meta.mtime).toBeInstanceOf(Date);
  });
});

describe('getExecutionLogFile', () => {
  test('returns null when the directory does not exist', async () => {
    const result = await getExecutionLogFile(1, path.join(dir, 'does-not-exist'));
    expect(result).toBeNull();
  });

  test('returns null when no file matches the execution ID', async () => {
    writeLog('exec-2-abc.log', 0);
    expect(await getExecutionLogFile(1, dir)).toBeNull();
  });

  test('finds the file whose name starts with exec-{id}-', async () => {
    writeLog('exec-42-somejobname.log', 0);
    const result = await getExecutionLogFile(42, dir);
    expect(result?.filename).toBe('exec-42-somejobname.log');
  });

  test('does not confuse execution ID 1 with execution ID 10+', async () => {
    writeLog('exec-10-abc.log', 0);
    // "exec-1-" should not prefix-match "exec-10-..."
    expect(await getExecutionLogFile(1, dir)).toBeNull();
    expect((await getExecutionLogFile(10, dir))?.filename).toBe('exec-10-abc.log');
  });
});

describe('cleanupOldLogs', () => {
  test('does nothing when file count is within the limit', async () => {
    writeLog('exec-1-a.log', 0);
    writeLog('exec-2-b.log', 0);
    await cleanupOldLogs(dir, 5);
    expect(await listExecutionLogFiles(dir)).toHaveLength(2);
  });

  test('deletes only the oldest files exceeding the limit', async () => {
    writeLog('exec-1-oldest.log', -300);
    writeLog('exec-2-middle.log', -200);
    writeLog('exec-3-newer.log', -100);
    writeLog('exec-4-newest.log', 0);

    await cleanupOldLogs(dir, 2);

    const remaining = (await listExecutionLogFiles(dir)).map((f) => f.filename).sort();
    expect(remaining).toEqual(['exec-3-newer.log', 'exec-4-newest.log']);
    expect(existsSync(path.join(dir, 'exec-1-oldest.log'))).toBe(false);
    expect(existsSync(path.join(dir, 'exec-2-middle.log'))).toBe(false);
  });

  test('does not throw when the directory does not exist', async () => {
    await expect(cleanupOldLogs(path.join(dir, 'does-not-exist'), 1)).resolves.toBeUndefined();
  });
});
