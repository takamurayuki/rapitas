/**
 * test-correlation-handlers.manual-run.test
 *
 * Unit tests for handlePostManualRun (routes/analytics/test-correlation).
 * Split out of test-correlation-handlers.test.ts to avoid growing that file
 * past the 300-line soft limit (COMPONENT_SPLITTING_POLICY §3-5).
 * RAPITAS_DATA_DIR is redirected to a tmp dir per test so runs never touch
 * the real backend's history file.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handlePostManualRun } from './test-correlation-handlers';
import { testCorrelationRoutes } from './test-correlation-router';
import { readRunHistory } from '../../../services/analytics/test-correlation';

let dataDir: string;
const originalDataDir = process.env.RAPITAS_DATA_DIR;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'rapitas-test-correlation-manual-run-'));
  process.env.RAPITAS_DATA_DIR = dataDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = originalDataDir;
});

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    changedFiles: ['a.ts'],
    testResults: [{ file: 'a.test.ts', status: 'fail' }],
    ...overrides,
  };
}

describe('handlePostManualRun', () => {
  test('returns 200 and persists a RunRecord with source=manual', () => {
    const result = handlePostManualRun(validBody());
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);

    const history = readRunHistory('/unused-backend-root');
    expect(history.runs).toHaveLength(1);
    expect(history.runs[0].source).toBe('manual');
    expect(history.runs[0].changedFiles).toEqual(['a.ts']);
    expect(history.runs[0].testResults).toEqual([{ file: 'a.test.ts', status: 'fail' }]);
    if (result.body.success) {
      expect(history.runs[0].runId).toBe(result.body.runId);
    }
  });

  test('defaults environment to platform=manual/runtimeVersion=n/a when unspecified', () => {
    handlePostManualRun(validBody());
    const history = readRunHistory('/unused-backend-root');
    expect(history.runs[0].environment).toEqual({ platform: 'manual', runtimeVersion: 'n/a' });
  });

  test('uses the provided environment and commitSha when specified', () => {
    handlePostManualRun(
      validBody({
        commitSha: 'abc123',
        environment: { platform: 'macOS', runtimeVersion: '20.0.0' },
      }),
    );
    const history = readRunHistory('/unused-backend-root');
    expect(history.runs[0].commitSha).toBe('abc123');
    expect(history.runs[0].environment).toEqual({ platform: 'macOS', runtimeVersion: '20.0.0' });
  });

  test('ignores a client-supplied source field and always records manual (prevents provenance spoofing)', () => {
    handlePostManualRun(validBody({ source: 'ci' }));
    const history = readRunHistory('/unused-backend-root');
    expect(history.runs[0].source).toBe('manual');
  });

  test('rejects an empty changedFiles array with 422 and records nothing', () => {
    const result = handlePostManualRun(validBody({ changedFiles: [] }));
    expect(result.status).toBe(422);
    expect(readRunHistory('/unused-backend-root').runs).toHaveLength(0);
  });

  test('rejects an empty testResults array with 422 and records nothing', () => {
    const result = handlePostManualRun(validBody({ testResults: [] }));
    expect(result.status).toBe(422);
    expect(readRunHistory('/unused-backend-root').runs).toHaveLength(0);
  });

  test('rejects an invalid testResults status with 422 and records nothing', () => {
    const result = handlePostManualRun(
      validBody({ testResults: [{ file: 'a.test.ts', status: 'unknown' }] }),
    );
    expect(result.status).toBe(422);
    expect(readRunHistory('/unused-backend-root').runs).toHaveLength(0);
  });
});

describe('POST /analytics/test-correlation/manual-run (router)', () => {
  const URL = 'http://localhost/analytics/test-correlation/manual-run';

  function post(body: unknown): Promise<Response> {
    return testCorrelationRoutes.handle(
      new Request(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  test('routes a valid body to the handler and returns 200 with runId', async () => {
    const res = await post(validBody());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; runId: string };
    expect(json.success).toBe(true);
    const history = readRunHistory('/unused-backend-root');
    expect(history.runs).toHaveLength(1);
    expect(history.runs[0].runId).toBe(json.runId);
    expect(history.runs[0].source).toBe('manual');
  });

  test('returns 422 through the router for an invalid body and records nothing', async () => {
    const res = await post(validBody({ changedFiles: [] }));
    expect(res.status).toBe(422);
    expect(readRunHistory('/unused-backend-root').runs).toHaveLength(0);
  });
});
