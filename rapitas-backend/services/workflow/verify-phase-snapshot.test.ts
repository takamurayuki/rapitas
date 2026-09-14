import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  takeVerifySnapshot,
  reconcileVerifySnapshot,
  restoreTrackedFiles,
  VERIFY_SNAPSHOT_TAG_PREFIX,
} from './verify-phase-snapshot';

let directory: string;
const prefix = join(tmpdir(), 'rapitas-verify-snapshot-');
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
const write = (name: string, content: string) => writeFileSync(join(directory, name), content);
const read = (name: string) => readFileSync(join(directory, name));

beforeEach(() => {
  directory = mkdtempSync(prefix);
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Verify snapshot test');
  // Disable line-ending conversion so restored content is compared byte-for-byte
  // (受入基準3) instead of through Windows git's autocrlf rewrite.
  git('config', 'core.autocrlf', 'false');
  write('tracked.txt', 'original\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
});

afterEach(() => {
  const target = resolve(directory);
  if (!target.startsWith(resolve(prefix)) || !target.startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unsafe test fixture cleanup path');
  }
  rmSync(target, { recursive: true, force: true });
});

test('takeVerifySnapshot creates a tag and leaves the working tree untouched', async () => {
  write('tracked.txt', 'implementer edit\n');
  write('new.txt', 'implementer new file\n');
  const beforeStatus = git('status', '--porcelain', '--untracked-files=all');

  const snapshot = await takeVerifySnapshot(directory, 917);

  expect(snapshot).not.toBeNull();
  expect(snapshot!.tagName.startsWith(VERIFY_SNAPSHOT_TAG_PREFIX)).toBe(true);
  expect(git('tag', '-l', `${VERIFY_SNAPSHOT_TAG_PREFIX}917-*`)).toBe(snapshot!.tagName);
  // Content and status unchanged by the snapshot itself.
  expect(git('status', '--porcelain', '--untracked-files=all')).toBe(beforeStatus);
  expect(read('tracked.txt').toString()).toBe('implementer edit\n');
  // The snapshot commit captured the untracked file too.
  expect(git('show', `${snapshot!.tagName}:new.txt`)).toBe('implementer new file');
});

test('takeVerifySnapshot unstages `git add -A` even when the tag step fails (検証懸念1)', async () => {
  write('tracked.txt', 'implementer edit\n');
  write('new.txt', 'implementer new file\n');

  const fixedNow = 1_700_000_000_000;
  const realDateNow = Date.now;
  const expectedTag = `${VERIFY_SNAPSHOT_TAG_PREFIX}917-${fixedNow}`;
  // Force the tag-creation step to fail deterministically by pre-creating a
  // tag with the exact name takeVerifySnapshot will attempt to create.
  git('tag', expectedTag, 'HEAD');
  Date.now = () => fixedNow;
  try {
    const snapshot = await takeVerifySnapshot(directory, 917);
    expect(snapshot).toBeNull();
  } finally {
    Date.now = realDateNow;
  }

  // The failed attempt's `git add -A` must not leave the index staged —
  // the verifier's `git status` should show the same unstaged edits as before.
  const status = git('status', '--porcelain', '--untracked-files=all');
  expect(status).toContain('M tracked.txt');
  expect(status).toContain('?? new.txt');
  expect(status).not.toContain('A  new.txt');
});

test('takeVerifySnapshot on a clean tree snapshots HEAD', async () => {
  const snapshot = await takeVerifySnapshot(directory, 917);
  expect(snapshot).not.toBeNull();
  expect(snapshot!.sha).toBe(git('rev-parse', 'HEAD'));
});

test('reconcileVerifySnapshot reports clean when nothing changed', async () => {
  const snapshot = await takeVerifySnapshot(directory, 917);
  const result = await reconcileVerifySnapshot(directory, snapshot!.tagName);
  expect(result).toEqual({ status: 'clean' });
});

test('reconcileVerifySnapshot restores a tracked file destroyed by git checkout --', async () => {
  write('tracked.txt', 'implementer edit\n');
  const snapshot = await takeVerifySnapshot(directory, 917);

  // Simulate the task-913 incident: verifier discards the implementer's edit.
  git('checkout', '--', 'tracked.txt');
  expect(read('tracked.txt').toString()).not.toBe('implementer edit\n');

  const result = await reconcileVerifySnapshot(directory, snapshot!.tagName);
  expect(result).toEqual({
    status: 'restored',
    restoredFiles: ['tracked.txt'],
    preservedDivergentFiles: [],
  });
  expect(read('tracked.txt').toString()).toBe('implementer edit\n');
});

test('reconcileVerifySnapshot restores after git reset --hard', async () => {
  write('tracked.txt', 'implementer edit\n');
  const snapshot = await takeVerifySnapshot(directory, 917);

  git('reset', '--hard', 'HEAD');
  expect(read('tracked.txt').toString()).not.toBe('implementer edit\n');

  const result = await reconcileVerifySnapshot(directory, snapshot!.tagName);
  expect(result.status).toBe('restored');
  expect(read('tracked.txt').toString()).toBe('implementer edit\n');
});

test('reconcileVerifySnapshot never touches new untracked files', async () => {
  const snapshot = await takeVerifySnapshot(directory, 917);
  write('verifier-repro.txt', 'reproduction test file\n');

  const result = await reconcileVerifySnapshot(directory, snapshot!.tagName);
  expect(result).toEqual({ status: 'clean' });
  expect(existsSync(join(directory, 'verifier-repro.txt'))).toBe(true);
});

test('reconcileVerifySnapshot preserves CRLF and multibyte UTF-8 content byte-for-byte', async () => {
  const original = Buffer.from('こんにちは\r\n実装済みの内容\r\n', 'utf8');
  writeFileSync(join(directory, 'tracked.txt'), original);
  const snapshot = await takeVerifySnapshot(directory, 917);

  // A real destructive operation (resets to HEAD's plain-LF committed
  // content) so the HEAD-fingerprint check classifies it as restorable.
  git('checkout', '--', 'tracked.txt');
  const result = await reconcileVerifySnapshot(directory, snapshot!.tagName);
  expect(result.status).toBe('restored');
  expect(read('tracked.txt')).toEqual(original);
});

test('reconcileVerifySnapshot reports unrecoverable for an unresolvable tag', async () => {
  const result = await reconcileVerifySnapshot(directory, `${VERIFY_SNAPSHOT_TAG_PREFIX}nope-0`);
  expect(result.status).toBe('unrecoverable');
  expect((result as { reason: string }).reason).toBeTruthy();
});

test('restoreTrackedFiles restores only the listed files', async () => {
  write('tracked.txt', 'edit-a\n');
  write('other.txt', 'other original\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'second file');
  const snapshot = await takeVerifySnapshot(directory, 917);

  write('tracked.txt', 'destroyed-a\n');
  write('other.txt', 'destroyed-other\n');

  const restored = await restoreTrackedFiles(directory, snapshot!.tagName, ['tracked.txt']);
  expect(restored).toEqual(['tracked.txt']);
  expect(read('tracked.txt').toString()).toBe('edit-a\n');
  expect(read('other.txt').toString()).toBe('destroyed-other\n');
});

test('competing-write scenario: a later write immediately followed by a destructive checkout is still restored', async () => {
  // A later write ("別プロセス" simulation) followed by the verifier's
  // destructive `checkout --` (which always resets to HEAD, overwriting
  // whatever came before it) — the file's FINAL content matches HEAD, so the
  // HEAD-fingerprint check in reconcileVerifySnapshot restores it.
  write('tracked.txt', 'implementer edit\n');
  const snapshot = await takeVerifySnapshot(directory, 917);

  write('tracked.txt', 'a later concurrent write\n'); // "別プロセス" simulation
  git('checkout', '--', 'tracked.txt'); // verifier's destructive operation (resets to HEAD)

  const result = await reconcileVerifySnapshot(directory, snapshot!.tagName);
  expect(result).toEqual({
    status: 'restored',
    restoredFiles: ['tracked.txt'],
    preservedDivergentFiles: [],
  });
  expect(read('tracked.txt').toString()).toBe('implementer edit\n');
});

test("reconcileVerifySnapshot preserves the implementer's continued edit when no destructive operation occurred (受入基準3)", async () => {
  // No `checkout --` / `reset --hard` at all — the implementer just kept
  // editing during the verify phase. The file's current content differs from
  // BOTH the snapshot tag AND HEAD, so it must NOT be silently overwritten
  // with the old snapshot content.
  write('tracked.txt', 'implementer edit v1\n');
  const snapshot = await takeVerifySnapshot(directory, 917);

  write('tracked.txt', 'implementer edit v2 (continued during verify)\n');

  const result = await reconcileVerifySnapshot(directory, snapshot!.tagName);
  expect(result).toEqual({ status: 'preserved', preservedFiles: ['tracked.txt'] });
  expect(read('tracked.txt').toString()).toBe('implementer edit v2 (continued during verify)\n');
});

test('reconcileVerifySnapshot restores content reset to a non-HEAD ancestor via `checkout <sha> -- <file>` (attempt-2 fix)', async () => {
  // A HEAD-only comparison would miss this: `git checkout <ancestor-sha> --
  // <file>` restores ONE file's content to an older commit's blob WITHOUT
  // moving HEAD (unlike `reset --hard`, which moves HEAD to its target and
  // would trivially match a plain HEAD comparison). The destroyed content
  // never matches current HEAD but DOES match an earlier commit in the
  // file's own history.
  write('tracked.txt', 'ancestor content\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'ancestor commit');
  const ancestorSha = git('rev-parse', 'HEAD');

  write('tracked.txt', 'another commit before the snapshot\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'later commit');
  const headBeforeDestruction = git('rev-parse', 'HEAD');

  write('tracked.txt', 'implementer edit\n');
  const snapshot = await takeVerifySnapshot(directory, 917);

  // Verifier's destructive operation: reset to an ancestor OTHER than HEAD,
  // without moving HEAD itself.
  git('checkout', ancestorSha, '--', 'tracked.txt');
  expect(git('rev-parse', 'HEAD')).toBe(headBeforeDestruction); // HEAD unchanged
  expect(read('tracked.txt').toString()).toBe('ancestor content\n');

  const result = await reconcileVerifySnapshot(directory, snapshot!.tagName);
  expect(result).toEqual({
    status: 'restored',
    restoredFiles: ['tracked.txt'],
    preservedDivergentFiles: [],
  });
  expect(read('tracked.txt').toString()).toBe('implementer edit\n');
});

test('reconcileVerifySnapshot restores a file the verifier deleted when history records its prior deletion (§判定失敗時の扱い)', async () => {
  // A file that was added and later removed (and that removal committed) —
  // deletion IS a state recorded in that path's commit history, so a
  // present-vs-absent comparison against the deletion commit matches.
  write('to-delete.txt', 'first version\n');
  git('add', 'to-delete.txt');
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'add file');
  git('rm', '--quiet', 'to-delete.txt');
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'remove file');

  // Implementer re-adds the file (uncommitted) as part of their work.
  write('to-delete.txt', 'implementer re-added content\n');
  const snapshot = await takeVerifySnapshot(directory, 917);

  // Verifier wipes it again (it is untracked again after the removal commit).
  git('clean', '-fd');
  expect(existsSync(join(directory, 'to-delete.txt'))).toBe(false);

  const result = await reconcileVerifySnapshot(directory, snapshot!.tagName);
  expect(result.status).toBe('restored');
  expect((result as { restoredFiles: string[] }).restoredFiles).toEqual(['to-delete.txt']);
  expect(read('to-delete.txt').toString()).toBe('implementer re-added content\n');
});

test('reconcileVerifySnapshot restores a brand-new untracked file the verifier deleted via git clean -fd (premortem #2)', async () => {
  write('brand-new.txt', 'implementer new file\n');
  const snapshot = await takeVerifySnapshot(directory, 917);

  // Simulate a verifier wiping untracked files (never in HEAD, never in the
  // index — so the HEAD-comparison must not throw or misclassify this).
  git('clean', '-fd');
  expect(existsSync(join(directory, 'brand-new.txt'))).toBe(false);

  const result = await reconcileVerifySnapshot(directory, snapshot!.tagName);
  expect(result).toEqual({
    status: 'restored',
    restoredFiles: ['brand-new.txt'],
    preservedDivergentFiles: [],
  });
  expect(read('brand-new.txt').toString()).toBe('implementer new file\n');
});
