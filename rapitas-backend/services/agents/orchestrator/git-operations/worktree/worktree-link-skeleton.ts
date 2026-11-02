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
 * leaves the target untouched.
 *
 * The links are not the only thing provisioned, though. Measured 2026-10-23,
 * after the junction handling shipped: the sweep still reclaimed nothing,
 * because all 161 leftovers also held `scripts/run-checked.cjs` — the
 * verification wrapper, copied in by the tooling, byte-identical to the
 * repository's own in every single one. A file, and so "work", and so kept
 * forever.
 *
 * Hence {@link ReclaimOptions.repoRoot}: a real file is disregarded only
 * when the checkout holds the same bytes at the same relative path. That is
 * evidence rather than a guess about filenames — an edited copy, a copy
 * under another name, or a file the checkout has never had all still mean
 * "someone's work, leave it". And with no checkout to compare against there
 * is no evidence at all, so one real file is again enough to keep the
 * directory exactly as it was.
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
 * Largest file this module will read in order to compare it.
 *
 * Only ever reached for a stray file inside a would-be skeleton, and the
 * provisioned wrapper is a few kilobytes. Anything past this is not read and
 * so not proven, which means the directory is kept.
 */
const MAX_COMPARE_BYTES = 1024 * 1024;

/** How to judge the files a leftover still holds. */
export interface ReclaimOptions {
  /**
   * The main checkout to compare stray files against.
   *
   * A file is disregarded only when this checkout holds the same bytes at
   * the same relative path. Omitted, every real file keeps the directory.
   */
  repoRoot?: string;
}

/**
 * Whether this directory holds nothing that is not already accounted for.
 *
 * Returns false for anything it cannot prove — a missing path, an unexplained
 * file at any depth, a tree deeper than {@link MAX_DEPTH}, or a directory it
 * cannot read. Saying "no" preserves the directory, which is the safe answer.
 *
 * @param dirPath - Directory to inspect / 調べるディレクトリ
 * @param options - What the stray files may be compared against / 判定条件
 * @returns True when nothing inside is unaccounted for / 残すべきものが無ければ true
 */
export function isLinkSkeleton(dirPath: string, options: ReclaimOptions = {}): boolean {
  return collectProvisioned(dirPath, '', 0, options) !== null;
}

/**
 * Walk a directory, gathering the provisioned copies that may be deleted.
 *
 * @returns Paths of the copies, or null when something must be kept / 削除可能な複製、残すべきものがあれば null
 */
function collectProvisioned(
  dirPath: string,
  relative: string,
  depth: number,
  options: ReclaimOptions,
): string[] | null {
  if (depth > MAX_DEPTH) return null;
  let entries: string[];
  try {
    // lstat, not stat: a link to a directory must not be entered.
    if (!fs.lstatSync(dirPath).isDirectory()) return null;
    entries = fs.readdirSync(dirPath);
  } catch {
    return null;
  }

  const provisioned: string[] = [];
  for (const entry of entries) {
    const child = join(dirPath, entry);
    const childRelative = relative ? `${relative}/${entry}` : entry;
    let stat;
    try {
      stat = fs.lstatSync(child);
    } catch {
      return null;
    }
    // A link is fine whatever it points at — removing it never touches the
    // target, so what is on the other side is none of this module's business.
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      const below = collectProvisioned(child, childRelative, depth + 1, options);
      if (below === null) return null;
      provisioned.push(...below);
      continue;
    }
    // A real file. Only a copy the checkout already has, at this same path,
    // is something nobody can lose by deleting.
    if (!matchesCheckout(child, childRelative, stat.size, options.repoRoot)) return null;
    provisioned.push(child);
  }
  return provisioned;
}

/**
 * Whether a file is byte-for-byte what the checkout holds at the same path.
 *
 * @param filePath - The stray file / 残っているファイル
 * @param relative - Its path within the leftover directory / 残骸内の相対パス
 * @param size - Its size, already known from the walk / 既知のサイズ
 * @param repoRoot - The checkout to compare against, if any / 比較対象のチェックアウト
 * @returns True only when the contents are proven identical / 内容が同一と確認できた場合のみ true
 */
function matchesCheckout(
  filePath: string,
  relative: string,
  size: number,
  repoRoot: string | undefined,
): boolean {
  if (!repoRoot) return false;
  if (size > MAX_COMPARE_BYTES) return false;
  const copy = readRegularFile(filePath, size);
  if (!copy) return false;
  const original = readRegularFile(join(repoRoot, relative), size);
  return original !== null && original.equals(copy);
}

/**
 * Read a file, having confirmed through the same handle that it is one.
 *
 * Statting a path and then reading that path are two separate lookups, and
 * what answered the first is not necessarily what answers the second. Here
 * that gap decides whether a file gets deleted, so the descriptor is opened
 * once and `fstat` interrogates the handle itself: what was checked and what
 * is read cannot come apart.
 *
 * NOTE: open follows a symlink, so this no longer distinguishes a link in
 * the checkout from the file it points at. That distinction was not worth
 * the race it cost — planting a link inside the checkout takes write access
 * to the checkout, and anyone with that can simply write the bytes instead.
 * The leftover side is unaffected: the walk skips links before reaching
 * here, and removal is always `unlink`, which never follows one.
 *
 * @param path - File to read / 読むファイル
 * @param size - The size it must still have / 一致すべきサイズ
 * @returns Its contents, or null when it is not that file / 内容、該当しなければ null
 */
function readRegularFile(path: string, size: number): Buffer | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(path, 'r');
    const stat = fs.fstatSync(fd);
    // A directory, a device, or a file that changed size since the walk saw
    // it is not the thing this was asked about.
    if (!stat.isFile() || stat.size !== size) return null;
    const buffer = Buffer.alloc(size);
    let read = 0;
    // readSync is free to return a short read; a partial buffer compared as
    // if it were whole would be zero-padding passing itself off as a match.
    while (read < size) {
      const chunk = fs.readSync(fd, buffer, read, size - read, read);
      if (chunk <= 0) return null;
      read += chunk;
    }
    return buffer;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Remove a directory holding nothing but links and provisioned copies.
 *
 * Walks the whole tree before it touches anything, so a directory that must
 * be kept is left exactly as it was found rather than half-deleted, and only
 * the files that walk individually vouched for are ever unlinked.
 *
 * @param dirPath - Directory to remove / 削除するディレクトリ
 * @param options - What the stray files may be compared against / 判定条件
 * @returns True when the directory is gone / 削除できたら true
 */
export function removeLinkSkeleton(dirPath: string, options: ReclaimOptions = {}): boolean {
  const provisioned = collectProvisioned(dirPath, '', 0, options);
  if (provisioned === null) return false;
  try {
    // Deleted by the exact paths the walk approved, never by re-deciding
    // here: one list, one judgement, no second chance to get it wrong.
    for (const file of provisioned) fs.unlinkSync(file);
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
