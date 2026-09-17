/**
 * eval-runner.test
 *
 * Unit tests for the pure/injectable functions in eval-runner.ts. Uses a
 * temp directory of fixture case files instead of the real
 * eval/private-set/cases so it stays independent of the current dataset size.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadCases, resolveCaseDir, runCase, summarize, type CaseResult } from '../eval-runner';
import type { EvalCase } from '../../eval/private-set/case-schema';

const dirsToClean: string[] = [];

function makeTempCaseDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eval-runner-test-'));
  dirsToClean.push(dir);
  return dir;
}

afterEach(() => {
  while (dirsToClean.length > 0) {
    const dir = dirsToClean.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const VALID_CASE: EvalCase = {
  id: 'case-x',
  category: 'bug-fix',
  taskDescription: 'test case',
  initialFiles: ['a.ts'],
  acceptanceCheck: 'true',
  expectedOutcome: 'fail-to-pass',
};

describe('resolveCaseDir', () => {
  it('returns the default dir when no --case-dir is given', () => {
    expect(resolveCaseDir([]).endsWith(join('eval', 'private-set', 'cases'))).toBe(true);
  });

  it('parses --case-dir=<path>', () => {
    expect(resolveCaseDir(['--case-dir=/tmp/foo']).endsWith(join('tmp', 'foo'))).toBe(true);
  });

  it('parses --case-dir <path> as two args', () => {
    expect(resolveCaseDir(['--case-dir', '/tmp/bar']).endsWith(join('tmp', 'bar'))).toBe(true);
  });
});

describe('loadCases', () => {
  it('returns empty arrays for a missing directory', () => {
    const result = loadCases('/does/not/exist/xyz');
    expect(result.cases).toEqual([]);
    expect(result.invalid).toEqual([]);
  });

  it('loads valid case files', () => {
    const dir = makeTempCaseDir();
    writeFileSync(join(dir, 'a.json'), JSON.stringify(VALID_CASE));
    const result = loadCases(dir);
    expect(result.cases).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
  });

  it('reports invalid schema files without throwing', () => {
    const dir = makeTempCaseDir();
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ id: 'x' }));
    const result = loadCases(dir);
    expect(result.cases).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
  });

  it('reports malformed JSON without throwing', () => {
    const dir = makeTempCaseDir();
    writeFileSync(join(dir, 'broken.json'), '{not json');
    const result = loadCases(dir);
    expect(result.cases).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
  });
});

describe('runCase', () => {
  it('marks a case passed when the runner resolves', async () => {
    const result = await runCase(VALID_CASE, async () => {});
    expect(result.passed).toBe(true);
    expect(result.ran).toBe(true);
  });

  it('marks a case failed when the runner throws', async () => {
    const result = await runCase(VALID_CASE, async () => {
      throw new Error('boom');
    });
    expect(result.passed).toBe(false);
    expect(result.error).toContain('boom');
  });
});

describe('summarize', () => {
  it('aggregates fail-to-pass and pass-to-pass counts separately', () => {
    const results: CaseResult[] = [
      { id: '1', category: 'bug-fix', expectedOutcome: 'fail-to-pass', ran: true, passed: true },
      { id: '2', category: 'bug-fix', expectedOutcome: 'fail-to-pass', ran: true, passed: false },
      { id: '3', category: 'feature', expectedOutcome: 'pass-to-pass', ran: true, passed: true },
    ];
    const summary = summarize(results);
    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(2);
    expect(summary.failToPassCount).toBe(2);
    expect(summary.failToPassPassed).toBe(1);
    expect(summary.passToPassCount).toBe(1);
    expect(summary.passToPassPassed).toBe(1);
  });

  it('handles an empty result set', () => {
    const summary = summarize([]);
    expect(summary.total).toBe(0);
    expect(summary.passed).toBe(0);
  });
});
