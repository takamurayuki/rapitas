/**
 * verification-scoped-edit.test
 *
 * Covers beginScopedEdit / assertSafeToMutate / restoreScopedEdit /
 * hasUnresolvedScopedEdit (task 1060: task-913's `git checkout --` incident
 * that destroyed an implementer's uncommitted work). Uses an isolated git
 * repository per test (execFileSync + mkdtempSync, same pattern as
 * worktree-preservation.test.ts) so the "uncommitted changes coexisting with
 * a temporary edit" scenario is exercised against real git state, not
 * simulated.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import {
  assertSafeToMutate,
  beginScopedEdit,
  hasUnresolvedScopedEdit,
  restoreScopedEdit,
} from './verification-scoped-edit';

let repoDir: string;
let dataDir: string;
const repoPrefix = join(tmpdir(), 'rapitas-scoped-edit-repo-');
const dataPrefix = join(tmpdir(), 'rapitas-scoped-edit-data-');
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
const write = (relPath: string, content: Buffer | string) =>
  writeFileSync(join(repoDir, relPath), content);
const read = (relPath: string) => readFileSync(join(repoDir, relPath));
const hashOf = (content: Buffer) => createHash('sha256').update(content).digest('hex');
let previousDataDir: string | undefined;

beforeEach(() => {
  repoDir = mkdtempSync(repoPrefix);
  dataDir = mkdtempSync(dataPrefix);
  previousDataDir = process.env.RAPITAS_DATA_DIR;
  process.env.RAPITAS_DATA_DIR = dataDir;
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Scoped edit test');
  write('test.spec.ts', 'original test content\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = previousDataDir;
  for (const target of [resolve(repoDir), resolve(dataDir)]) {
    if (!target.startsWith(resolve(tmpdir()) + sep)) {
      throw new Error('Unsafe test fixture cleanup path');
    }
    rmSync(target, { recursive: true, force: true });
  }
});

test('normal 3-point flow: snapshot, safe-to-mutate check, mutate, restore all agree', async () => {
  write('test.spec.ts', 'implementer uncommitted content\n');
  const handle = await beginScopedEdit(repoDir, 1060, ['test.spec.ts']);

  const safety = await assertSafeToMutate(handle);
  expect(safety.safe).toBe(true);

  write('test.spec.ts', 'verifier temporary content\n');
  const afterMutateHash = hashOf(read('test.spec.ts'));

  const result = await restoreScopedEdit(handle, { 'test.spec.ts': afterMutateHash });
  expect(result).toEqual({ restored: true });
  expect(read('test.spec.ts')).toEqual(Buffer.from('implementer uncommitted content\n'));
  expect(hasUnresolvedScopedEdit(1060)).toBe(false);
});

test('premortem #1 (plan.md): a mid-window implementer edit is detected by assertSafeToMutate and the mutation must not proceed', async () => {
  // Sequence: (1) snapshot taken, (2) implementer edits the file before the
  // verifier's own mutation. assertSafeToMutate must catch this BEFORE the
  // verifier applies its destructive edit, so the implementer's change is
  // never overwritten in the first place (the 2-point design's flaw from
  // the prior round — see plan.md's premortem #1).
  const handle = await beginScopedEdit(repoDir, 1060, ['test.spec.ts']);

  write('test.spec.ts', 'implementer mid-window edit\n');

  const safety = await assertSafeToMutate(handle);
  expect(safety.safe).toBe(false);
  if (!safety.safe) {
    expect(safety.reason).toBe('concurrent_edit_detected_before_mutate');
    expect(safety.conflictingFiles).toEqual(['test.spec.ts']);
  }
  // The implementer's edit must still be on disk — the verifier is expected
  // to abort here and never apply its own mutation.
  expect(read('test.spec.ts')).toEqual(Buffer.from('implementer mid-window edit\n'));
  expect(hasUnresolvedScopedEdit(1060)).toBe(true);
});

test('concurrent edit detection (restore window): a third-party edit between mutate and restore aborts and preserves evidence', async () => {
  write('test.spec.ts', 'implementer uncommitted content\n');
  const handle = await beginScopedEdit(repoDir, 1060, ['test.spec.ts']);

  const safety = await assertSafeToMutate(handle);
  expect(safety.safe).toBe(true);

  write('test.spec.ts', 'verifier temporary content\n');
  const afterMutateHash = hashOf(read('test.spec.ts'));

  // A third party (e.g. the implementer's still-running process) edits the
  // file again before the verifier restores it.
  write('test.spec.ts', 'yet another concurrent edit\n');

  const result = await restoreScopedEdit(handle, { 'test.spec.ts': afterMutateHash });
  expect(result.restored).toBe(false);
  if (!result.restored) {
    expect(result.reason).toBe('concurrent_edit_detected');
    expect(result.conflictingFiles).toEqual(['test.spec.ts']);
  }
  // The concurrent edit must not be overwritten.
  expect(read('test.spec.ts')).toEqual(Buffer.from('yet another concurrent edit\n'));
  expect(hasUnresolvedScopedEdit(1060)).toBe(true);
});

test('new file: created by the verifier is removed on restore only when unmodified since', async () => {
  const handle = await beginScopedEdit(repoDir, 1060, ['new-temp-file.txt']);
  expect(handle.entries[0]).toMatchObject({
    relPath: 'new-temp-file.txt',
    existedBefore: false,
    beforeHash: null,
  });

  const safety = await assertSafeToMutate(handle);
  expect(safety.safe).toBe(true);

  write('new-temp-file.txt', 'created by verifier\n');
  const afterMutateHash = hashOf(read('new-temp-file.txt'));

  const result = await restoreScopedEdit(handle, { 'new-temp-file.txt': afterMutateHash });
  expect(result).toEqual({ restored: true });
  expect(existsSync(join(repoDir, 'new-temp-file.txt'))).toBe(false);
});

test('new file: another process wrote different content — restore refuses to delete it', async () => {
  const handle = await beginScopedEdit(repoDir, 1060, ['new-temp-file.txt']);
  write('new-temp-file.txt', 'created by verifier\n');
  const afterMutateHash = hashOf(read('new-temp-file.txt'));

  // Someone else overwrote it before restore ran.
  write('new-temp-file.txt', 'someone else wrote this instead\n');

  const result = await restoreScopedEdit(handle, { 'new-temp-file.txt': afterMutateHash });
  expect(result.restored).toBe(false);
  expect(existsSync(join(repoDir, 'new-temp-file.txt'))).toBe(true);
  expect(read('new-temp-file.txt')).toEqual(Buffer.from('someone else wrote this instead\n'));
});

test('line endings and non-UTF-8 bytes are preserved byte-for-byte through restore', async () => {
  const crlfAndBinary = Buffer.from([
    ...Buffer.from('line1\r\nline2\r\n'),
    0x82,
    0xa0, // Shift_JIS byte sequence, not valid UTF-8
    0x00,
    0xff,
  ]);
  write('test.spec.ts', crlfAndBinary);
  const handle = await beginScopedEdit(repoDir, 1060, ['test.spec.ts']);

  const safety = await assertSafeToMutate(handle);
  expect(safety.safe).toBe(true);

  write('test.spec.ts', 'verifier replaced content\n');
  const afterMutateHash = hashOf(read('test.spec.ts'));

  const result = await restoreScopedEdit(handle, { 'test.spec.ts': afterMutateHash });
  expect(result).toEqual({ restored: true });
  expect(read('test.spec.ts').equals(crlfAndBinary)).toBe(true);
});

test('hasUnresolvedScopedEdit is false when no manifest has ever been written for the task', () => {
  expect(hasUnresolvedScopedEdit(999999)).toBe(false);
});

test('manifest write failure (invalid RAPITAS_DATA_DIR target) rejects before any mutation is authorized', async () => {
  // Point RAPITAS_DATA_DIR at a path that collides with an existing file,
  // so mkdirSync recursive creation fails.
  const blockerFile = join(dataDir, 'blocker');
  writeFileSync(blockerFile, 'not a directory target');
  process.env.RAPITAS_DATA_DIR = join(blockerFile, 'nested');

  await expect(beginScopedEdit(repoDir, 1060, ['test.spec.ts'])).rejects.toThrow();
});
