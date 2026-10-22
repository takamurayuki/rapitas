/**
 * worktree-link-skeleton.test
 *
 * Reclaiming what `git worktree remove` leaves behind.
 *
 * `setup-worktree.cjs` links the main checkout's `node_modules` into a
 * worktree as junctions. Git does not know about them, so removing the
 * worktree takes the tracked files and leaves the links — and the orphan
 * sweeper only deletes directories that are completely EMPTY, which these
 * never are. Measured 2026-10-22: 3 worktrees registered with git, 164
 * directories under `.worktrees/`, 161 of them nothing but link skeletons.
 *
 * The reason the sweeper is that cautious is the same reason this has to be
 * careful: those junctions point AT the main checkout's dependency tree, and
 * a recursive delete follows them. So the property these tests exist for is
 * not "the directory went away" — it is "the directory went away and the
 * thing it pointed at did not".
 */
import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLinkSkeleton, removeLinkSkeleton } from './worktree-link-skeleton';

let root: string;
/** Stands in for the main checkout's node_modules — must survive everything. */
let shared: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wt-skeleton-'));
  shared = join(root, 'main-node-modules');
  mkdirSync(shared, { recursive: true });
  writeFileSync(join(shared, 'precious.txt'), 'the dependency tree');
});

afterEach(() => {
  // The links are gone by now in the passing cases; where they are not, rmSync
  // would follow them, so unlink-aware teardown is the test's own concern.
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best effort — the OS reclaims the temp dir */
  }
});

/** A worktree directory as setup-worktree.cjs leaves it: links, nothing else. */
function skeleton(name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  symlinkSync(shared, join(dir, 'node_modules'), 'junction');
  for (const sub of ['rapitas-backend', 'rapitas-frontend', 'scripts']) {
    mkdirSync(join(dir, sub), { recursive: true });
    symlinkSync(shared, join(dir, sub, 'node_modules'), 'junction');
  }
  return dir;
}

describe('recognising a link skeleton', () => {
  test('says yes to links and the directories holding them', () => {
    expect(isLinkSkeleton(skeleton('task-1-aaa'))).toBe(true);
  });

  test('says yes to an empty directory', () => {
    const dir = join(root, 'empty');
    mkdirSync(dir);
    expect(isLinkSkeleton(dir)).toBe(true);
  });

  test('says no as soon as one real file is in there', () => {
    // This is the whole point of the sweeper's caution: a file means work
    // that nobody has accounted for, and it must survive.
    const dir = skeleton('task-2-bbb');
    writeFileSync(join(dir, 'rapitas-backend', 'uncommitted.ts'), 'work');
    expect(isLinkSkeleton(dir)).toBe(false);
  });

  test('says no to a file hidden one level deeper', () => {
    const dir = skeleton('task-3-ccc');
    mkdirSync(join(dir, 'rapitas-frontend', 'src'), { recursive: true });
    writeFileSync(join(dir, 'rapitas-frontend', 'src', 'page.tsx'), 'work');
    expect(isLinkSkeleton(dir)).toBe(false);
  });

  test('never walks into what a link points at', () => {
    // `shared` holds a real file. Following the junction would find it and
    // call the skeleton nonempty — the directory would then be preserved
    // forever, which is exactly the bug being fixed.
    const dir = skeleton('task-4-ddd');
    expect(existsSync(join(shared, 'precious.txt'))).toBe(true);
    expect(isLinkSkeleton(dir)).toBe(true);
  });

  test('refuses a tree deeper than it will vouch for', () => {
    // An unbounded walk is a denial of service on a pathological tree, and
    // "I did not look" must read as "do not delete".
    let dir = join(root, 'deep');
    mkdirSync(dir);
    for (let i = 0; i < 12; i++) {
      dir = join(dir, `level-${i}`);
      mkdirSync(dir);
    }
    expect(isLinkSkeleton(join(root, 'deep'))).toBe(false);
  });

  test('says no to something that is not there', () => {
    expect(isLinkSkeleton(join(root, 'absent'))).toBe(false);
  });
});

describe('removing a link skeleton', () => {
  test('takes the directory and leaves the dependency tree alone', () => {
    const dir = skeleton('task-5-eee');
    expect(removeLinkSkeleton(dir)).toBe(true);
    expect(existsSync(dir)).toBe(false);
    // The property worth the whole module: the junction target is intact.
    expect(existsSync(shared)).toBe(true);
    expect(existsSync(join(shared, 'precious.txt'))).toBe(true);
    expect(readdirSync(shared)).toEqual(['precious.txt']);
  });

  test('refuses anything that is not a skeleton, and changes nothing', () => {
    const dir = skeleton('task-6-fff');
    writeFileSync(join(dir, 'keep-me.txt'), 'work');
    expect(removeLinkSkeleton(dir)).toBe(false);
    expect(existsSync(join(dir, 'keep-me.txt'))).toBe(true);
    expect(existsSync(join(dir, 'node_modules'))).toBe(true);
  });

  test('removes an empty directory too', () => {
    const dir = join(root, 'empty-one');
    mkdirSync(dir);
    expect(removeLinkSkeleton(dir)).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  test('reports failure rather than throwing when the path is gone', () => {
    expect(removeLinkSkeleton(join(root, 'absent'))).toBe(false);
  });
});
