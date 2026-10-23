/**
 * WorktreeLinkSkeleton
 *
 * Reclaims the link scaffolding `setup-worktree.cjs` leaves behind once a
 * worktree's tracked files are gone. Owns only that shape; the sweep that
 * decides WHICH directories to offer is worktree-filesystem-orphans.ts.
 *
 * `setup-worktree.cjs` junctions the main checkout's `node_modules` into a
 * worktree (and into each package under it) so the dependency tree is shared.
 * Git has no record of those links, so `git worktree remove` takes the tracked
 * files and leaves them standing. The orphan sweep then refuses the directory
 * forever, because it only removes directories that are completely EMPTY and
 * one holding four junctions is not.
 *
 * Measured 2026-10-22: git had three worktrees registered and `.worktrees/`
 * held 164 directories — 161 of them nothing but this scaffolding.
 *
 * The sweep's caution is not misplaced, and this module inherits it. Those
 * junctions point AT the main checkout's dependency tree, and a recursive
 * delete follows them: that is how the whole tree was lost on 2026-09-02. So
 * nothing here ever recurses through a link — directories are read with
 * `lstat`, links are removed with `unlink`, which detaches the link and
 * leaves the target untouched — and a directory is only ever removed once it
 * has been proven to hold nothing but links and more such directories. One
 * real file anywhere inside and it is left exactly as it was.
 */

// Namespace import, not named: sibling suites in this directory replace the
// whole of `node:fs` with `mock.module`, and a named import of something
// their stub omits fails at link time and takes that whole file's tests with
// it (CLAUDE.md's "watch the pass COUNT" hazard, from the importing side).
import * as fs from 'node:fs';
import { join } from 'node:path';

/**
 * How far down the walk will vouch for a directory.
 *
 * The scaffolding is two deep (`<worktree>/<package>/node_modules`), so this
 * is generous. It is a bound rather than a limit on the shape: an unbounded
 * walk is a denial of service on a pathological tree, and a tree this module
 * has not fully inspected must read as "do not delete", never as "empty".
 */
const MAX_DEPTH = 4;

/**
 * Whether this directory contains nothing but links and empty directories.
 *
 * Returns false for anything it cannot prove — a missing path, a real file at
 * any depth, a tree deeper than {@link MAX_DEPTH}, or a directory it cannot
 * read. Saying "no" preserves the directory, which is the safe answer.
 *
 * @param dirPath - Directory to inspect / 調べるディレクトリ
 * @param depth - Recursion depth, internal / 再帰の深さ（内部用）
 * @returns True when the directory holds only links / リンクのみなら true
 */
export function isLinkSkeleton(dirPath: string, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  let entries: string[];
  try {
    // lstat, not stat: a link to a directory must not be entered.
    if (!fs.lstatSync(dirPath).isDirectory()) return false;
    entries = fs.readdirSync(dirPath);
  } catch {
    return false;
  }

  for (const entry of entries) {
    const child = join(dirPath, entry);
    let stat;
    try {
      stat = fs.lstatSync(child);
    } catch {
      return false;
    }
    // A link is fine whatever it points at — removing it never touches the
    // target, so what is on the other side is none of this module's business.
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (!isLinkSkeleton(child, depth + 1)) return false;
      continue;
    }
    // A real file: unaccounted-for work. The directory stays.
    return false;
  }
  return true;
}

/**
 * Remove a directory that holds nothing but links, links first.
 *
 * Checks before it touches anything, so a directory that is not a skeleton is
 * left exactly as it was found rather than half-deleted.
 *
 * @param dirPath - Directory to remove / 削除するディレクトリ
 * @returns True when the directory is gone / 削除できたら true
 */
export function removeLinkSkeleton(dirPath: string): boolean {
  if (!isLinkSkeleton(dirPath)) return false;
  try {
    detachLinks(dirPath);
    fs.rmdirSync(dirPath);
    return true;
  } catch {
    // Partial removal is possible here — a link may be detached and the
    // rmdir then fail on a lock. That leaves a smaller skeleton, which the
    // next sweep picks up; it never leaves a file deleted.
    return false;
  }
}

/**
 * Detach every link below a proven skeleton and remove its directories.
 *
 * Depth-first so each directory is empty by the time it is removed. Only ever
 * called on a tree {@link isLinkSkeleton} has already walked.
 *
 * @param dirPath - Directory to empty / 空にするディレクトリ
 */
function detachLinks(dirPath: string): void {
  for (const entry of fs.readdirSync(dirPath)) {
    const child = join(dirPath, entry);
    const stat = fs.lstatSync(child);
    if (stat.isSymbolicLink()) {
      // unlink removes the link itself. On Windows a directory junction is
      // reported as a symbolic link and unlink is the matching removal, so
      // the main checkout's node_modules on the other side is untouched.
      fs.unlinkSync(child);
      continue;
    }
    detachLinks(child);
    fs.rmdirSync(child);
  }
}
