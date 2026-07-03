/**
 * Judge Eval Results Snapshot テスト
 *
 * Verifies path resolution under RAPITAS_DATA_DIR, the write/read round-trip,
 * and that reads never throw on a missing or corrupt snapshot file — mirroring
 * the tmpdir + RAPITAS_DATA_DIR pattern used by cycle-event-logger.test.ts.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getJudgeEvalResultPath,
  writeJudgeEvalResult,
  readJudgeEvalResult,
  type JudgeEvalResult,
} from '../../services/observability/eval-judge-results';

describe('eval-judge-results', () => {
  let dir: string;
  const origDataDir = process.env.RAPITAS_DATA_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'judge-eval-'));
    process.env.RAPITAS_DATA_DIR = dir;
  });

  afterEach(() => {
    if (origDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = origDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  test('getJudgeEvalResultPath places the snapshot under <DATA_DIR>/logs', () => {
    expect(getJudgeEvalResultPath()).toBe(join(dir, 'logs', 'eval-judge-latest.json'));
  });

  test('readJudgeEvalResult returns null when the eval has never run', () => {
    expect(readJudgeEvalResult()).toBeNull();
  });

  test('writeJudgeEvalResult then readJudgeEvalResult round-trips the snapshot', () => {
    const result: JudgeEvalResult = {
      timestamp: '2026-07-02T00:00:00.000Z',
      provider: 'claude',
      correct: 4,
      total: 5,
      errored: 0,
      accuracy: 0.8,
      minAccuracy: 0.8,
      passed: true,
      cases: [{ name: 'pass: clean refactor', expected: 'pass', got: 'pass', ok: true }],
    };

    writeJudgeEvalResult(result);

    expect(readJudgeEvalResult()).toEqual(result);
  });

  test('readJudgeEvalResult returns null (never throws) on a corrupt snapshot file', () => {
    mkdirSync(join(dir, 'logs'), { recursive: true });
    writeFileSync(getJudgeEvalResultPath(), '{ not valid json', 'utf-8');

    expect(() => readJudgeEvalResult()).not.toThrow();
    expect(readJudgeEvalResult()).toBeNull();
  });

  test('writeJudgeEvalResult never throws even if the data dir cannot be created', () => {
    // Point RAPITAS_DATA_DIR at a path that collides with an existing file,
    // so mkdirSync must fail — the write must be swallowed, not propagated.
    const blocked = join(dir, 'blocked-file');
    writeFileSync(blocked, 'x');
    process.env.RAPITAS_DATA_DIR = blocked;

    expect(() =>
      writeJudgeEvalResult({
        timestamp: new Date().toISOString(),
        provider: 'claude',
        correct: 0,
        total: 0,
        errored: 0,
        accuracy: 0,
        minAccuracy: 0.8,
        passed: false,
        cases: [],
      }),
    ).not.toThrow();
  });
});
