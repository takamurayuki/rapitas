/**
 * test-correlation-handlers.test.ts
 *
 * Route-level tests via Elysia handle() for matrix/drilldown, plus direct
 * handler calls for pr-scan (which takes an injectable gh runner — no test
 * invokes the real gh CLI). RAPITAS_DATA_DIR is redirected to a tmp dir per
 * test so runs never touch the real backend's history files.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { testCorrelationRoutes } from './test-correlation-router';
import { handlePostPrScan } from './test-correlation-handlers';
import { writeRunHistory } from '../../../services/analytics/test-correlation';
import type { RunHistoryFile } from '../../../services/analytics/test-correlation';
import type { GhRunner } from '../../../services/analytics/test-correlation';

const BASE = 'http://localhost/analytics/test-correlation';

let dataDir: string;
const originalDataDir = process.env.RAPITAS_DATA_DIR;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'rapitas-test-correlation-handlers-'));
  process.env.RAPITAS_DATA_DIR = dataDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = originalDataDir;
});

function seedHistory(history: RunHistoryFile): void {
  writeRunHistory(history, '/unused-backend-root');
}

const NOW = new Date().toISOString();

function seededHistory(): RunHistoryFile {
  return {
    version: 1,
    runs: [
      {
        runId: 'run-1',
        timestamp: NOW,
        source: 'ci',
        commitSha: 'sha1',
        changedFiles: ['a.ts'],
        testResults: [{ file: 'a.test.ts', status: 'fail' }],
        environment: { platform: 'win32', runtimeVersion: '1.0.0' },
      },
      {
        runId: 'run-2',
        timestamp: NOW,
        source: 'local',
        commitSha: 'sha2',
        changedFiles: [],
        testResults: [{ file: 'a.test.ts', status: 'pass' }],
        environment: { platform: 'win32', runtimeVersion: '1.0.0' },
      },
    ],
  };
}

describe('GET /analytics/test-correlation/matrix', () => {
  test('returns 200 with computed cells from seeded run history', async () => {
    seedHistory(seededHistory());
    const res = await testCorrelationRoutes.handle(new Request(`${BASE}/matrix`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; cells: Array<Record<string, unknown>> };
    expect(body.success).toBe(true);
    expect(body.cells).toHaveLength(1);
    expect(body.cells[0]).toMatchObject({
      changedFile: 'a.ts',
      testFile: 'a.test.ts',
      sampleSize: 2,
    });
  });

  test('returns 200 with an empty cell list when no history exists', async () => {
    const res = await testCorrelationRoutes.handle(new Request(`${BASE}/matrix`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cells: unknown[] };
    expect(body.cells).toEqual([]);
  });

  test('rejects a non-positive windowMonths with 422', async () => {
    const res = await testCorrelationRoutes.handle(new Request(`${BASE}/matrix?windowMonths=0`));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });
});

describe('GET /analytics/test-correlation/drilldown', () => {
  test('returns the failure event for a matching cell', async () => {
    seedHistory(seededHistory());
    const res = await testCorrelationRoutes.handle(
      new Request(`${BASE}/drilldown?changedFile=a.ts&testFile=a.test.ts`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<Record<string, unknown>> };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ runId: 'run-1', commitSha: 'sha1', source: 'ci' });
  });

  test('returns an empty list for a cell with no matching failures', async () => {
    seedHistory(seededHistory());
    const res = await testCorrelationRoutes.handle(
      new Request(`${BASE}/drilldown?changedFile=nonexistent.ts&testFile=a.test.ts`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toEqual([]);
  });

  test('returns failureTail for a failing run that recorded output', async () => {
    const history = seededHistory();
    history.runs[0].failureTail = { 'a.test.ts': ['expected 1 received 2'] };
    seedHistory(history);
    const res = await testCorrelationRoutes.handle(
      new Request(`${BASE}/drilldown?changedFile=a.ts&testFile=a.test.ts`),
    );
    const body = (await res.json()) as { entries: Array<Record<string, unknown>> };
    expect(body.entries[0].failureTail).toEqual(['expected 1 received 2']);
  });

  test('omits failureTail for runs recorded before failure logs were stored', async () => {
    seedHistory(seededHistory());
    const res = await testCorrelationRoutes.handle(
      new Request(`${BASE}/drilldown?changedFile=a.ts&testFile=a.test.ts`),
    );
    const body = (await res.json()) as { entries: Array<Record<string, unknown>> };
    expect('failureTail' in body.entries[0]).toBe(false);
  });

  test('rejects a missing changedFile with 422', async () => {
    const res = await testCorrelationRoutes.handle(
      new Request(`${BASE}/drilldown?testFile=a.test.ts`),
    );
    expect(res.status).toBe(422);
  });
});

describe('POST /analytics/test-correlation/pr-scan', () => {
  test('scores changed test files from the mocked gh response and does not invoke the real gh CLI', async () => {
    seedHistory(seededHistory());
    const runGh = mock<GhRunner>(async () => JSON.stringify({ files: [{ path: 'a.ts' }] }));

    const result = await handlePostPrScan({ prNumber: 7, notify: false }, '/repo', runGh);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    if (result.body.success) {
      expect(result.body.entries.map((e) => e.testFile)).toContain('a.test.ts');
      expect(result.body.notified).toBe(false);
    }
    expect(runGh).toHaveBeenCalledTimes(1);
  });

  test('rejects a non-integer prNumber with 422 without calling gh', async () => {
    const runGh = mock<GhRunner>(async () => '{}');
    const result = await handlePostPrScan({ prNumber: 'abc' }, '/repo', runGh);
    expect(result.status).toBe(422);
    expect(runGh).not.toHaveBeenCalled();
  });
});
