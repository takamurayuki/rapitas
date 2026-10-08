/**
 * run-history-store.test.ts
 *
 * Unit tests for services/analytics/test-correlation/run-history-store.ts.
 * Covers I/O fallback behavior, pruning, and the DI'd git-diff resolver.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  appendRunRecord,
  getRunHistoryPath,
  MAX_RUN_RECORDS,
  pruneRunHistory,
  readRunHistory,
  resolveChangedFiles,
  writeRunHistory,
} from './run-history-store';
import type { RunHistoryFile, RunRecord } from './test-correlation.types';

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: 'run-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    source: 'local',
    commitSha: 'abc123',
    changedFiles: ['src/a.ts'],
    testResults: [{ file: 'src/a.test.ts', status: 'pass' }],
    environment: { platform: 'win32', runtimeVersion: '1.0.0' },
    ...overrides,
  };
}

describe('getRunHistoryPath / readRunHistory / writeRunHistory', () => {
  let dataDir: string;
  const originalDataDir = process.env.RAPITAS_DATA_DIR;
  const originalExplicit = process.env.RAPITAS_TEST_CORRELATION_HISTORY_PATH;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'rapitas-run-history-'));
    delete process.env.RAPITAS_TEST_CORRELATION_HISTORY_PATH;
    process.env.RAPITAS_DATA_DIR = dataDir;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = originalDataDir;
    if (originalExplicit === undefined) delete process.env.RAPITAS_TEST_CORRELATION_HISTORY_PATH;
    else process.env.RAPITAS_TEST_CORRELATION_HISTORY_PATH = originalExplicit;
  });

  test('resolves path under RAPITAS_DATA_DIR', () => {
    expect(getRunHistoryPath('/backend/root')).toBe(
      join(dataDir, 'test-correlation-run-history.json'),
    );
  });

  test('returns empty history when file does not exist', () => {
    expect(readRunHistory('/backend/root')).toEqual({ version: 1, runs: [] });
  });

  test('returns empty history when file is corrupt JSON', () => {
    const path = getRunHistoryPath('/backend/root');
    writeFileSync(path, '{ not valid json', 'utf-8');
    expect(readRunHistory('/backend/root')).toEqual({ version: 1, runs: [] });
  });

  test('returns empty history when parsed JSON has no runs array', () => {
    const path = getRunHistoryPath('/backend/root');
    writeFileSync(path, JSON.stringify({ version: 1 }), 'utf-8');
    expect(readRunHistory('/backend/root')).toEqual({ version: 1, runs: [] });
  });

  test('writeRunHistory persists via atomic rename and readRunHistory reads it back', () => {
    const history: RunHistoryFile = { version: 1, runs: [makeRun()] };
    writeRunHistory(history, '/backend/root');
    expect(readRunHistory('/backend/root')).toEqual(history);

    const path = getRunHistoryPath('/backend/root');
    expect(existsSync(path)).toBe(true);
    // NOTE: No leftover .tmp-* files after a successful atomic write.
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  test('writeRunHistory does not throw when the target directory is invalid', () => {
    process.env.RAPITAS_DATA_DIR = join(dataDir, 'missing-nested', 'dir');
    expect(() => writeRunHistory({ version: 1, runs: [] }, '/backend/root')).not.toThrow();
  });
});

describe('pruneRunHistory', () => {
  test('removes runs older than the retention window', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const history: RunHistoryFile = {
      version: 1,
      runs: [
        makeRun({ runId: 'old', timestamp: '2026-01-01T00:00:00.000Z' }),
        makeRun({ runId: 'recent', timestamp: '2026-05-20T00:00:00.000Z' }),
      ],
    };
    const pruned = pruneRunHistory(history, now, 3);
    expect(pruned.runs.map((r) => r.runId)).toEqual(['recent']);
  });

  test('keeps the most recent MAX_RUN_RECORDS when over the cap', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const runs: RunRecord[] = Array.from({ length: MAX_RUN_RECORDS + 10 }, (_, i) =>
      makeRun({
        runId: `run-${i}`,
        timestamp: new Date(now.getTime() - (MAX_RUN_RECORDS + 10 - i) * 1000).toISOString(),
      }),
    );
    const pruned = pruneRunHistory({ version: 1, runs }, now, 3);
    expect(pruned.runs).toHaveLength(MAX_RUN_RECORDS);
    // NOTE: The most recent record (highest index) must survive the cap.
    expect(pruned.runs.at(-1)?.runId).toBe(`run-${MAX_RUN_RECORDS + 9}`);
  });

  test('excludes a run with an unparsable timestamp', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const history: RunHistoryFile = {
      version: 1,
      runs: [makeRun({ runId: 'bad-ts', timestamp: 'not-a-date' })],
    };
    expect(pruneRunHistory(history, now, 3).runs).toEqual([]);
  });
});

describe('appendRunRecord', () => {
  let dataDir: string;
  const originalDataDir = process.env.RAPITAS_DATA_DIR;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'rapitas-run-history-append-'));
    process.env.RAPITAS_DATA_DIR = dataDir;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = originalDataDir;
  });

  test('appends to existing history and persists the pruned result', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    appendRunRecord(
      makeRun({ runId: 'first', timestamp: now.toISOString() }),
      '/backend/root',
      now,
    );
    appendRunRecord(
      makeRun({ runId: 'second', timestamp: now.toISOString() }),
      '/backend/root',
      now,
    );

    const history = readRunHistory('/backend/root');
    expect(history.runs.map((r) => r.runId)).toEqual(['first', 'second']);
  });
});

describe('resolveChangedFiles', () => {
  test('returns ok=true with parsed file list on success', async () => {
    const runDiff = async (args: string[]) => {
      expect(args).toEqual(['diff', '--name-only', 'HEAD~1...HEAD']);
      return 'src/a.ts\nsrc/b.ts\n';
    };
    const result = await resolveChangedFiles('HEAD~1', '/repo', runDiff);
    expect(result).toEqual({ ok: true, files: ['src/a.ts', 'src/b.ts'] });
  });

  test('returns ok=true with an empty array when there is genuinely no diff', async () => {
    const result = await resolveChangedFiles('HEAD~1', '/repo', async () => '');
    expect(result).toEqual({ ok: true, files: [] });
  });

  test('returns ok=false and never throws when git fails', async () => {
    const runDiff = async () => {
      throw new Error('fatal: bad revision');
    };
    const result = await resolveChangedFiles('HEAD~1', '/repo', runDiff);
    expect(result).toEqual({ ok: false, files: [] });
  });
});
