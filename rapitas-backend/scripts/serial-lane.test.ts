/**
 * serial-lane.test
 *
 * Unit tests for the serial-lane partitioning used by scripts/parallel-test.ts.
 */

import { describe, test, expect } from 'bun:test';
import {
  SUBPROCESS_HEAVY_TEST_PATTERNS,
  parseSerialPatterns,
  partitionSerialFiles,
  resolveParallelWorkerCount,
} from './serial-lane';

describe('SUBPROCESS_HEAVY_TEST_PATTERNS', () => {
  test.each([
    'C:\\repo\\rapitas-backend\\services\\agents\\orchestrator\\git-operations\\worktree\\worktree-guard.test.ts',
    '/repo/rapitas-backend/services/agents/orchestrator/git-operations/core/diff-structured.test.ts',
    '/repo/rapitas-backend/services/agents/verification/automated-verifier.diff-base-ref.test.ts',
    '/repo/rapitas-backend/tests/services/schema-change-gate.integration.test.ts',
    'C:\\repo\\rapitas-backend\\scripts\\check-ssot-drift.test.ts',
  ])('routes real-subprocess suite to the serial lane: %s', (file) => {
    expect(SUBPROCESS_HEAVY_TEST_PATTERNS.some((p) => p.test(file))).toBe(true);
  });

  test.each([
    '/repo/rapitas-backend/services/agents/orchestrator/git-operations/pr/branch-pr-ops.test.ts',
    '/repo/rapitas-backend/services/agents/orchestrator/execution-resume.test.ts',
    '/repo/rapitas-backend/tests/routes/workflow/workflow-routes.test.ts',
    '/repo/rapitas-backend/services/agents/verification/automated-verifier.test.ts',
  ])('keeps mocked suites in the parallel pool: %s', (file) => {
    expect(SUBPROCESS_HEAVY_TEST_PATTERNS.some((p) => p.test(file))).toBe(false);
  });
});

describe('parseSerialPatterns', () => {
  test('returns no patterns for undefined or empty input', () => {
    expect(parseSerialPatterns(undefined)).toEqual([]);
    expect(parseSerialPatterns('')).toEqual([]);
  });

  test('compiles comma-separated entries and skips blanks', () => {
    const patterns = parseSerialPatterns(' foo\\.test\\.ts$ ,, bar ');
    expect(patterns).toHaveLength(2);
    expect(patterns[0].test('/x/foo.test.ts')).toBe(true);
    expect(patterns[1].test('/x/bar.test.ts')).toBe(true);
  });

  test('throws on an invalid regex instead of silently ignoring it', () => {
    expect(() => parseSerialPatterns('(unclosed')).toThrow(SyntaxError);
  });
});

describe('partitionSerialFiles', () => {
  test('splits by pattern while preserving input order in each group', () => {
    const files = ['/a/one.test.ts', '/a/git-x.test.ts', '/a/two.test.ts', '/a/git-y.test.ts'];
    const result = partitionSerialFiles(files, [/git-/]);
    expect(result.parallel).toEqual(['/a/one.test.ts', '/a/two.test.ts']);
    expect(result.serial).toEqual(['/a/git-x.test.ts', '/a/git-y.test.ts']);
  });

  test('keeps every file when no pattern matches, dropping none', () => {
    const files = ['/a/one.test.ts', '/a/two.test.ts'];
    const result = partitionSerialFiles(files, []);
    expect(result.parallel).toEqual(files);
    expect(result.serial).toEqual([]);
  });
});

describe('resolveParallelWorkerCount', () => {
  test.each([
    { label: 'reserves one slot when the serial lane is used', args: [4, 100, 5], expected: 3 },
    { label: 'uses full concurrency without serial files', args: [4, 100, 0], expected: 4 },
    { label: 'never drops below one parallel worker', args: [1, 100, 5], expected: 1 },
    { label: 'caps workers at the parallel file count', args: [8, 2, 5], expected: 2 },
    { label: 'returns 0 when the parallel pool is empty', args: [4, 0, 5], expected: 0 },
  ])('$label', ({ args, expected }) => {
    const [concurrency, parallelCount, serialCount] = args;
    expect(resolveParallelWorkerCount(concurrency, parallelCount, serialCount)).toBe(expected);
  });
});
