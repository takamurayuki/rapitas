/**
 * coverage-test-files.test
 *
 * 2026-11-21: trendline task 1512 (Go) added 235 lines to
 * internal/api/server_test.go, and the coverage gate still reported "no test
 * changed" because it only knew JS/TS test names. The task could never open
 * its PR.
 */
import { describe, expect, test } from 'bun:test';
import { isCoverageExempt, isCoverageTestFile } from './coverage-test-files';
import { coverageCheck } from './automated-verifier';

describe('isCoverageTestFile', () => {
  test.each([
    'src/foo.test.ts',
    'web/app/page.spec.tsx',
    'internal/api/server_test.go',
    'tests/test_parser.py',
    'pkg/parser_test.py',
    'crates/core/tests/round_trip.rs',
    'src/test/java/app/ParserTest.java',
    'app/src/test/kotlin/ParserTests.kt',
    'spec/models/user_spec.rb',
  ])('recognises %s as a test', (path) => {
    expect(isCoverageTestFile(path)).toBe(true);
  });

  test.each([
    'internal/api/server.go',
    'src/foo.ts',
    'app/contest.py',
    'src/latest_results.rs',
    'src/main/java/app/Tester.java',
  ])('does not treat %s as a test', (path) => {
    expect(isCoverageTestFile(path)).toBe(false);
  });
});

describe('isCoverageExempt', () => {
  test.each(['src/foo.d.ts', 'vite.config.ts', 'src/Button.stories.tsx'])('%s', (path) => {
    expect(isCoverageExempt(path)).toBe(true);
  });
});

describe('coverageCheck with non-JS projects', () => {
  test('a Go change with a changed _test.go passes', () => {
    const r = coverageCheck(['internal/api/server.go', 'internal/api/server_test.go'], true);
    expect(r?.ok).toBe(true);
  });

  test('a Go change without a test still fails', () => {
    const r = coverageCheck(['internal/api/server.go', 'cmd/server/main.go'], true);
    expect(r?.ok).toBe(false);
  });

  test('a test-only Go change needs nothing more', () => {
    expect(coverageCheck(['internal/api/server_test.go'], true)).toBeNull();
  });
});
