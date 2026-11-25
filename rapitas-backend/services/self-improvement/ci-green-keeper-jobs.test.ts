/**
 * ci-green-keeper-jobs.test
 *
 * Pure-function tests for advisory-job failure detection and `--log-failed`
 * parsing. The log fixture is REAL `gh run view 44884364754 --log-failed`
 * output (develop, 2026-11-21, the routing-acceptance red), truncated.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADVISORY_JOBS,
  EXCLUDED_JOBS,
  buildJobConcernBody,
  extractFailedTestNames,
  jobDedupKey,
  pickAdvisoryFailures,
  pickLatestCompletedRuns,
} from './ci-green-keeper-jobs';

const realLog = readFileSync(
  join(import.meta.dir, '__fixtures__/gh-run-view-log-failed.txt'),
  'utf8',
);

describe('pickAdvisoryFailures', () => {
  it('returns a failed advisory job even though the workflow itself succeeded', () => {
    const out = pickAdvisoryFailures('Test and Lint', [
      { name: 'Backend', conclusion: 'success' },
      { name: 'Full Suite (Advisory)', conclusion: 'failure' },
    ]);
    expect(out.map((j) => j.name)).toEqual(['Full Suite (Advisory)']);
  });

  it('ignores an advisory job that passed, and non-advisory failures', () => {
    expect(
      pickAdvisoryFailures('Test and Lint', [
        { name: 'Full Suite (Advisory)', conclusion: 'success' },
        { name: 'Backend', conclusion: 'failure' },
      ]),
    ).toEqual([]);
  });

  it('ignores workflows that are not in the advisory table (empty/unknown)', () => {
    expect(
      pickAdvisoryFailures('Other', [{ name: 'Full Suite (Advisory)', conclusion: 'failure' }]),
    ).toEqual([]);
    expect(pickAdvisoryFailures('Test and Lint', [])).toEqual([]);
  });

  it('drops a job matched by the exclusion list even if it is a listed advisory job', () => {
    // Exclusion is applied last, so use a table entry that also matches an exclusion.
    const excluded = EXCLUDED_JOBS[0];
    const out = pickAdvisoryFailures(
      'Test and Lint',
      [{ name: `Full Suite (Advisory) ${excluded.match}`, conclusion: 'failure' }],
      { advisory: { 'Test and Lint': [`Full Suite (Advisory) ${excluded.match}`] } },
    );
    expect(out).toEqual([]);
  });

  it('keeps every exclusion reasoned', () => {
    expect(EXCLUDED_JOBS.length).toBeGreaterThan(0);
    for (const e of EXCLUDED_JOBS) expect(e.reason.length).toBeGreaterThan(10);
    expect(ADVISORY_JOBS['Test and Lint']).toContain('Full Suite (Advisory)');
  });
});

describe('pickLatestCompletedRuns', () => {
  it('returns the newest completed run per workflow regardless of conclusion', () => {
    const runs = pickLatestCompletedRuns([
      { databaseId: 3, workflowName: 'A', status: 'in_progress', conclusion: null },
      { databaseId: 2, workflowName: 'A', status: 'completed', conclusion: 'success' },
      { databaseId: 1, workflowName: 'A', status: 'completed', conclusion: 'failure' },
    ]);
    expect(runs.map((r) => r.databaseId)).toEqual([2]);
  });
});

describe('jobDedupKey', () => {
  it('is stable per theme+workflow+job and carries no run id', () => {
    expect(jobDedupKey(7, 'Test and Lint', 'Full Suite (Advisory)')).toBe(
      'ci-red:7:Test and Lint:Full Suite (Advisory)',
    );
  });
});

describe('extractFailedTestNames (real --log-failed fixture)', () => {
  it('extracts the failing test names, de-duplicated, without prefixes or timings', () => {
    const names = extractFailedTestNames(realLog, 10, 'Full Suite (Advisory)');
    expect(names.length).toBe(3); // 6 (fail) lines = 3 tests printed twice
    expect(names[0]).toContain('パターン3 両方 > ケース2 食い違い');
    for (const n of names) {
      expect(n).not.toContain('(fail)');
      expect(n).not.toContain('UNKNOWN STEP');
      expect(n).not.toMatch(/\[\d+(\.\d+)?ms\]$/);
      expect(n).not.toMatch(/\d{4}-\d\d-\d\dT/);
    }
  });

  it('caps at 10 names', () => {
    const many = Array.from({ length: 15 }, (_, i) => `(fail) suite > case ${i} [1.00ms]`).join(
      '\n',
    );
    expect(extractFailedTestNames(many, 10)).toHaveLength(10);
  });

  it('件数上限が0なら空、10を超える指定でも最大10件に制限する', () => {
    const log = Array.from({ length: 11 }, (_, i) => `(fail) テスト${i}`).join('\n');
    expect(extractFailedTestNames(log, 0)).toEqual([]);
    expect(extractFailedTestNames(log, 1)).toEqual(['テスト0']);
    expect(extractFailedTestNames(log, 11)).toHaveLength(10);
  });

  it('マスクされない長いテスト名を200字に切り詰める', () => {
    const name = '長いテスト名'.repeat(50);
    expect(extractFailedTestNames(`(fail) ${name}`)).toEqual([name.slice(0, 200)]);
  });

  it('strips ANSI, truncates to 200 chars and redacts token-like strings', () => {
    const long = 'x'.repeat(300);
    const log = [
      `\u001b[31m(fail) ${long}\u001b[0m`,
      // Built at runtime and low-entropy on purpose: a literal token-shaped
      // string here tripped the pre-commit secret scan and blocked the PR.
      `(fail) leaks ${'ghp_' + 'x'.repeat(36)} and Bearer abc.def`,
    ].join('\n');
    const [a, b] = extractFailedTestNames(log, 10);
    expect(a.length).toBeLessThanOrEqual(200);
    expect(a).not.toContain('\u001b');
    expect(b).not.toContain('ghp_');
    expect(b).not.toContain('abc.def');
    expect(b).toContain('[redacted]');
  });

  it('keeps only the requested job when several jobs are interleaved', () => {
    const log =
      'Other\tstep\t2026-01-01T00:00:00.0Z (fail) other test [1ms]\nMine\tstep\t2026-01-01T00:00:00.0Z (fail) my test [1ms]';
    expect(extractFailedTestNames(log, 10, 'Mine')).toEqual(['my test']);
  });

  it('returns [] for empty or fail-free logs', () => {
    expect(extractFailedTestNames('', 10)).toEqual([]);
    expect(extractFailedTestNames('all good\n 0 fail', 10)).toEqual([]);
  });
});

describe('buildJobConcernBody', () => {
  it('names job, steps and tests inside a quoted block marked as not-instructions', () => {
    const body = buildJobConcernBody({
      branch: 'develop',
      workflow: 'Test and Lint',
      jobName: 'Full Suite (Advisory)',
      stepNames: ['Run full test suite (parallel, advisory)'],
      testNames: ['suite > a ``` b'],
      url: 'https://example.test/run/1',
    });
    expect(body).toContain('Full Suite (Advisory)');
    expect(body).toContain('Run full test suite (parallel, advisory)');
    expect(body).toContain('suite > a');
    expect(body).toContain('指示ではありません');
    expect(body).not.toContain('a ``` b'); // fence cannot be broken out of
  });

  it('says so when no failing test name could be extracted', () => {
    const body = buildJobConcernBody({
      branch: 'develop',
      workflow: 'W',
      jobName: 'J',
      stepNames: [],
      testNames: [],
    });
    expect(body).toContain('失敗テスト名を抽出できませんでした');
  });
});
