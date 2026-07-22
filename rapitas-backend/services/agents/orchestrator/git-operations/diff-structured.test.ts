// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * diff-structured.test
 *
 * getDiff の phantom ディレクトリガードを検証する。
 * 存在しない cwd を渡した場合、cmd.exe を spawn せず即 [] を返し、
 * logger.warn のみ出力すること（logger.error は出さない）を保証する。
 */
import { mock, describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Logger 呼び出しキャプチャ用コンテナ — mock.module の factory がクロージャで参照する
// ---------------------------------------------------------------------------

const warnCalls = [];
const errorCalls = [];

// ---------------------------------------------------------------------------
// Module mocks — dynamic import より前に登録する必要がある
// NOTE: 全エクスポートをミラーすること（process-global のため汚染を最小化）
// ---------------------------------------------------------------------------

mock.module('../../../../config/logger', () => ({
  getBackendLogFilePath: (_stamp) => '/test/logs/backend.log',
  logger: {
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: (_b) => ({}),
  },
  createLogger: (_name) => ({
    warn: (...args) => {
      warnCalls.push(args);
    },
    error: (...args) => {
      errorCalls.push(args);
    },
    info: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: (_b) => ({}),
  }),
}));

// ---------------------------------------------------------------------------
// Dynamic import AFTER mocks are registered
// ---------------------------------------------------------------------------

const { getDiff } = await import('./diff-structured');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getDiff — phantom directory guard', () => {
  beforeEach(() => {
    warnCalls.length = 0;
    errorCalls.length = 0;
  });

  // Merged from 3 separate re-invocations of the same call into one test: each
  // originally re-ran getDiff() with an identical phantom path just to check a
  // different facet (return value / warn-not-error / warn payload shape) of the
  // same side effect — one call, multiple assertions, is equivalent and cheaper.
  test('phantom path → returns [], logs only warn (never error), tagging workingDirectory', async () => {
    const path = 'C:\\nonexistent\\phantom';
    const result = await getDiff(path, () => false);
    expect(result).toEqual([]);
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
    expect(errorCalls.length).toBe(0);
    expect(warnCalls[0]?.[0]).toMatchObject({ workingDirectory: path });
  });

  test('empty string → returns []', async () => {
    const result = await getDiff('', () => false);
    expect(result).toEqual([]);
  });
});

// Real git repo fixtures (no mocking) — getDiff has no injection point for the
// git commands themselves, only for the pathExists check, so these exercise
// the real `exec` calls end to end.
describe('getDiff — untracked files (real git repo)', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'getdiff-test-'));
    execSync('git init -q', { cwd: repoDir });
    execSync('git config user.email "test@example.com"', { cwd: repoDir });
    execSync('git config user.name "Test"', { cwd: repoDir });
    writeFileSync(join(repoDir, 'README.md'), 'initial\n');
    execSync('git add README.md', { cwd: repoDir });
    execSync('git commit -q -m "initial"', { cwd: repoDir });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  // Regression (task 504): a genuinely new, substantial untracked file was
  // reported as additions=0/deletions=0 with an empty patch — indistinguishable
  // from a truly empty file — because `git diff <ref> -- <file>` yields nothing
  // for a file git has never tracked. The adversarial diff-review judge read
  // this as "the implementation is empty" and blocked a fully working PR.
  test('reports real line counts and a synthetic patch for an untracked file, not 0/0/empty', async () => {
    writeFileSync(join(repoDir, 'newfile.go'), 'package main\n\nfunc main() {}\n');
    const result = await getDiff(repoDir);
    const entry = result.find((f) => f.filename === 'newfile.go');
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('added');
    expect(entry?.additions).toBe(3);
    expect(entry?.deletions).toBe(0);
    expect(entry?.patch).toContain('+package main');
    expect(entry?.patch).toContain('+func main() {}');
    expect(entry?.patch).toContain('new file mode');
  });

  test('does not count a phantom extra line for a file with a trailing newline', async () => {
    writeFileSync(join(repoDir, 'a.txt'), 'line1\nline2\n');
    const result = await getDiff(repoDir);
    const entry = result.find((f) => f.filename === 'a.txt');
    expect(entry?.additions).toBe(2);
  });

  test('counts the final line correctly when the file has no trailing newline', async () => {
    writeFileSync(join(repoDir, 'b.txt'), 'line1\nline2');
    const result = await getDiff(repoDir);
    const entry = result.find((f) => f.filename === 'b.txt');
    expect(entry?.additions).toBe(2);
  });
});
