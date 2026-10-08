/**
 * node-modules-link
 *
 * Shares one project's node_modules with its worktrees by link, and tells a
 * genuine install apart from a stray tool cache.
 *
 * NOT responsible for running installs or for deciding when to — that is
 * project-dependency-bootstrap's job.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createLogger } from '../../../../../config/logger';
import { SCAN_DEPTH } from './project-manifests';

const logger = createLogger('git-operations/node-modules-link');

/**
 * Entries that mean a real node_modules holds an actual install. Everything
 * else at the top level of a dot-only directory is a regenerable tool cache.
 */
const INSTALL_MARKERS = ['.bin', '.pnpm', '.package-lock.json', '.modules.yaml', '.yarn-state.yml'];

/**
 * True when `dir/node_modules` holds packages rather than only tool caches.
 *
 * A worktree can carry a node_modules containing nothing but `.vite` /
 * `.vite-temp` (Vite writes its cache there on first run). Treating that as an
 * install made the link step skip the directory forever, so the agent never got
 * `node_modules/.bin` and every gate kept failing — observed on task 1153.
 *
 * Follows links, so it also answers "does this link point at a usable tree?".
 *
 * @param dir - Directory holding node_modules / node_modules を持つディレクトリ
 * @returns Whether it is a genuine install / 本物のインストールか
 */
export function holdsRealInstall(dir: string): boolean {
  let entries: string[];
  try {
    entries = readdirSync(join(dir, 'node_modules'));
  } catch {
    return false;
  }
  return entries.some((name) => !name.startsWith('.') || INSTALL_MARKERS.includes(name));
}

/** What sits at a prospective link path. */
export function inspectLinkPath(link: string): 'link' | 'real' | 'absent' {
  try {
    return lstatSync(link).isSymbolicLink() ? 'link' : 'real';
  } catch {
    return 'absent';
  }
}

/**
 * Remove a link (not its target).
 *
 * NOTE: `rmSync(..., { recursive: true })` must never be used here — on Windows
 * it descends THROUGH a junction and deletes the shared tree it points at.
 * unlink is the correct call for both POSIX symlinks and Windows junctions;
 * rmdir is the documented fallback for a junction unlink refuses.
 *
 * @param link - Link path to clear / 解除するリンクのパス
 * @returns Whether the path is now free / パスが空いたか
 */
function removeLink(link: string): boolean {
  for (const remove of [unlinkSync, rmdirSync]) {
    try {
      remove(link);
      return true;
    } catch {
      /* try the next form */
    }
  }
  logger.warn({ link }, '[nodeModulesLink] Could not remove a stale node_modules link');
  return false;
}

/**
 * Delete a node_modules that {@link holdsRealInstall} rejected, so a link can
 * take its place.
 *
 * Safe to recurse here, unlike {@link removeLink}: this path is a real
 * directory (never a junction) whose only contents are regenerable tool caches
 * — that is what being rejected by holdsRealInstall means.
 */
function removeCacheOnlyNodeModules(link: string): boolean {
  try {
    rmSync(link, { recursive: true, force: true });
    logger.info(
      `[nodeModulesLink] Removed a cache-only node_modules to link the shared tree: ${link}`,
    );
    return true;
  } catch (err) {
    logger.warn({ err, link }, '[nodeModulesLink] Could not remove a cache-only node_modules');
    return false;
  }
}

/**
 * Directories under `source` that own a node_modules, relative to source.
 *
 * Driven by what is on disk rather than by parsing workspace globs: a package
 * dir only needs linking if the install actually created a node_modules in it.
 *
 * @param source - Project root holding the installed tree / インストール済みルート
 * @returns Relative dirs, root ('') first / リンク対象の相対パス
 */
export function discoverInstalledDirs(source: string): string[] {
  const dirs: string[] = [];
  const walk = (rel: string, depth: number): void => {
    if (existsSync(join(source, rel, 'node_modules'))) dirs.push(rel);
    if (depth > SCAN_DEPTH) return;
    let children: string[];
    try {
      children = readdirSync(join(source, rel), { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch {
      return;
    }
    for (const name of children) walk(rel ? `${rel}/${name}` : name, depth + 1);
  };
  walk('', 1);
  return dirs;
}

/**
 * Link every node_modules `source` owns into `worktree`.
 *
 * A real install in the worktree is left alone; a cache-only directory is
 * replaced. An existing LINK is kept whenever it still resolves to a usable
 * tree even if it points somewhere else — a project set up by an earlier
 * version may be linked elsewhere, and breaking a working link to re-point it
 * would strand the agent with nothing.
 *
 * @param source - Project root to link from / リンク元のプロジェクトルート
 * @param worktree - Worktree to link into / リンク先の worktree
 * @returns Relative dirs now linked / リンク済みの相対パス
 */
export function linkNodeModules(source: string, worktree: string): string[] {
  const linked: string[] = [];
  for (const rel of discoverInstalledDirs(source)) {
    const target = join(source, rel, 'node_modules');
    const link = join(worktree, rel, 'node_modules');

    let existing = inspectLinkPath(link);
    if (existing === 'link') {
      if (holdsRealInstall(join(worktree, rel))) {
        linked.push(rel);
        continue;
      }
      if (!removeLink(link)) continue;
      existing = 'absent';
    }
    if (existing === 'real') {
      if (holdsRealInstall(join(worktree, rel))) continue;
      if (!removeCacheOnlyNodeModules(link)) continue;
    }

    try {
      mkdirSync(dirname(link), { recursive: true });
      // 'junction' is honored on Windows (no admin needed), ignored on POSIX.
      symlinkSync(target, link, 'junction');
      linked.push(rel);
    } catch (err) {
      logger.warn({ err, link, target }, '[nodeModulesLink] Failed to link node_modules');
    }
  }
  return linked;
}

/**
 * True when the worktree can already resolve dependencies — a real install of
 * its own, or a link that still reaches one.
 *
 * @param worktree - Worktree to check / 対象 worktree
 * @returns Whether node_modules is usable as-is / そのまま使えるか
 */
export function worktreeHasUsableModules(worktree: string): boolean {
  const state = inspectLinkPath(join(worktree, 'node_modules'));
  if (state === 'absent') return false;
  if (state === 'link') {
    try {
      // A dangling junction resolves to nothing; holdsRealInstall follows it.
      readlinkSync(join(worktree, 'node_modules'));
    } catch {
      return false;
    }
  }
  return holdsRealInstall(worktree);
}
