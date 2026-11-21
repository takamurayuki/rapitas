/**
 * automated-verifier.coverage-go.test
 *
 * Drives the real runAutomatedVerification over a real git repository, because
 * the first fix (#1654) only taught coverageCheck the Go test name: the list it
 * received was still filtered to JS/TS extensions, so trendline task 1512 was
 * blocked with coverage=NG a second time (2026-11-21).
 */
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

mock.module('../../../config/database', () => ({
  prisma: { task: { findUnique: () => Promise.resolve(null) } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('./runtime-verification-stage', () => ({
  runRuntimeVerificationStage: async () => null,
}));
const { runAutomatedVerification } = await import('./automated-verifier');

let root = '';
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });

/** A Go repository on `develop` with one committed file, then a work branch. */
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'coverage-go-'));
  git('init', '--quiet', '-b', 'develop');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  await mkdir(join(root, 'internal', 'api'), { recursive: true });
  await writeFile(join(root, 'go.mod'), 'module example\n\ngo 1.22\n');
  await writeFile(join(root, 'internal', 'api', 'server.go'), 'package api\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'base');
  git('checkout', '--quiet', '-b', 'work');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const coverageOf = async () => {
  const r = await runAutomatedVerification(root, { requireTests: true });
  return r.checks.find((c) => c.name === 'coverage');
};

test('a Go fix that changes a _test.go passes the coverage gate', async () => {
  await writeFile(join(root, 'internal', 'api', 'server.go'), 'package api\n\nfunc A() {}\n');
  await writeFile(join(root, 'internal', 'api', 'server_test.go'), 'package api\n');
  expect((await coverageOf())?.ok).toBe(true);
}, 30000);

test('a Go fix with no test still fails the coverage gate', async () => {
  await writeFile(join(root, 'internal', 'api', 'server.go'), 'package api\n\nfunc A() {}\n');
  const coverage = await coverageOf();
  expect(coverage?.ok).toBe(false);
  expect(coverage?.details).toContain('internal/api/server.go');
}, 30000);

test('a docs-only change asks for no test', async () => {
  await writeFile(join(root, 'README.md'), '# notes\n');
  expect(await coverageOf()).toBeUndefined();
}, 30000);
