/**
 * GitOperations — Dependency Bootstrap for non-rapitas project worktrees
 *
 * Makes node_modules available in a worktree of a project that is NOT the
 * rapitas checkout (a scaffolded app under its own theme). rapitas worktrees are
 * handled by `scripts/setup-worktree.cjs`; a generated project has no such
 * script, so `installWorktreeDependencies` logged a warning and returned,
 * leaving the agent with zero dependencies — every gate then reported
 * "unverified" and verify bounced forever (tasks 1152/1153, 2026-10-08).
 *
 * One shared tree per project, worktrees only ever get links:
 *   - The tree lives in a gitignored sidecar (`<root>/.rapitas-deps`), NOT in
 *     the root checkout. Installing needs the manifests next to node_modules,
 *     and writing those into the root working tree would leave it permanently
 *     dirty and block `git checkout` once the PR adds the same files.
 *   - The install runs ONLY when the manifest fingerprint changes: first setup,
 *     an edited package.json, a new lockfile, a new workspace package. Adding a
 *     dependency mid-task is therefore picked up automatically on the next
 *     agent launch — nothing is pinned to "once per project".
 *   - Worktrees are linked, never installed into.
 *
 * NOT responsible for deciding whether a task needs dependencies
 * (`taskNeedsDependencies`) or for rapitas worktrees.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { createLogger } from '../../../../../config/logger';

const execAsync = promisify(exec);
const logger = createLogger('git-operations/project-dependency-bootstrap');

// A first install pulls the whole tree over the network; linking is seconds.
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const INSTALL_BUFFER_BYTES = 64 * 1024 * 1024;

/** How deep below the project root to look for workspace manifests. */
const SCAN_DEPTH = 3;

/** Sidecar holding the shared dependency tree; gitignored, never committed. */
export const SIDECAR_DIR = '.rapitas-deps';

const FINGERPRINT_FILE = '.rapitas-fingerprint';

/** Root-level files that change what an install produces. */
const ROOT_MANIFESTS = [
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  '.npmrc',
  '.nvmrc',
];

/** Lockfile → install command, most specific first. */
const LOCKFILES: ReadonlyArray<readonly [string, string]> = [
  ['pnpm-lock.yaml', 'pnpm install'],
  ['bun.lockb', 'bun install'],
  ['bun.lock', 'bun install'],
  ['yarn.lock', 'yarn install'],
  ['package-lock.json', 'npm install'],
];

/**
 * The project root that owns `worktreePath`, i.e. the parent of `.worktrees/`.
 *
 * @param worktreePath - Worktree (or project) path / worktree のパス
 * @returns Owning project root, or the path itself when it is not a worktree / 所有プロジェクトのルート
 */
export function projectRootOf(worktreePath: string): string {
  for (const marker of [`${sep}.worktrees${sep}`, '/.worktrees/']) {
    const idx = worktreePath.indexOf(marker);
    if (idx > 0) return worktreePath.slice(0, idx);
  }
  return worktreePath;
}

/**
 * Pick the install command for a manifest directory.
 *
 * Falls back to the `packageManager` field and then to pnpm when a
 * `pnpm-workspace.yaml` is present, because a first setup has no lockfile yet —
 * which is exactly when this runs.
 *
 * @param dir - Directory holding package.json / package.json のあるディレクトリ
 * @returns Shell command to install / 実行するインストールコマンド
 */
export function resolveInstallCommand(dir: string): string {
  for (const [lockfile, command] of LOCKFILES) {
    if (existsSync(join(dir, lockfile))) return command;
  }
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      packageManager?: unknown;
    };
    if (typeof pkg.packageManager === 'string') {
      const name = pkg.packageManager.split('@')[0];
      if (['pnpm', 'yarn', 'npm', 'bun'].includes(name)) return `${name} install`;
    }
  } catch {
    /* unreadable manifest — fall through to the workspace/npm default */
  }
  return existsSync(join(dir, 'pnpm-workspace.yaml')) ? 'pnpm install' : 'npm install';
}

/**
 * Relative paths of every manifest file in `source`, root files first.
 *
 * @param source - Checkout to scan / 走査するチェックアウト
 * @returns Relative manifest paths, sorted / 相対パス（ソート済み）
 */
export function collectManifests(source: string): string[] {
  const found = ROOT_MANIFESTS.filter((f) => existsSync(join(source, f)));
  const walk = (rel: string, depth: number): void => {
    if (depth > SCAN_DEPTH) return;
    let dirs: string[];
    try {
      dirs = readdirSync(join(source, rel), { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch {
      return;
    }
    for (const name of dirs) {
      const childRel = rel ? `${rel}/${name}` : name;
      if (existsSync(join(source, childRel, 'package.json'))) {
        found.push(`${childRel}/package.json`);
      }
      walk(childRel, depth + 1);
    }
  };
  walk('', 1);
  return found.sort();
}

/**
 * Fingerprint of the manifest set: changes exactly when an install would
 * produce something different.
 *
 * @param source - Checkout to fingerprint / 対象チェックアウト
 * @param manifests - Relative paths from {@link collectManifests} / 相対パス
 * @returns Hex digest, or '' when there is no manifest at all / ダイジェスト
 */
export function fingerprintManifests(source: string, manifests: string[]): string {
  if (manifests.length === 0) return '';
  const hash = createHash('sha256');
  for (const rel of manifests) {
    hash.update(rel);
    hash.update('\0');
    try {
      hash.update(readFileSync(join(source, rel)));
    } catch {
      hash.update('<unreadable>');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** True when `dir/node_modules` exists and is a real directory (not a link). */
function hasRealNodeModules(dir: string): boolean {
  try {
    return !lstatSync(join(dir, 'node_modules')).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Keep the sidecar out of `git status` for the project root. */
function excludeSidecar(root: string): void {
  try {
    const gitDir = join(root, '.git');
    if (!existsSync(gitDir) || !statSync(gitDir).isDirectory()) return;
    const exclude = join(gitDir, 'info', 'exclude');
    const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    if (current.includes(SIDECAR_DIR)) return;
    mkdirSync(dirname(exclude), { recursive: true });
    appendFileSync(exclude, `\n# rapitas shared dependency tree\n/${SIDECAR_DIR}/\n`, 'utf8');
  } catch (err) {
    logger.warn({ err, root }, '[projectBootstrap] Could not exclude the sidecar (non-fatal)');
  }
}

/**
 * Rebuild the sidecar's manifest set from `source` and install into it.
 *
 * @throws {Error} When the install fails / インストールが失敗した場合
 */
async function installSidecar(sidecar: string, source: string, manifests: string[]): Promise<void> {
  for (const rel of manifests) {
    const dest = join(sidecar, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(source, rel), dest);
  }
  const command = resolveInstallCommand(sidecar);
  const startedAt = Date.now();
  try {
    await execAsync(command, {
      cwd: sidecar,
      encoding: 'utf8',
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: INSTALL_BUFFER_BYTES,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, `[projectBootstrap] \`${command}\` failed in ${sidecar}`);
    throw new Error(`${command} failed for ${sidecar}: ${message}`);
  }
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  logger.info(`[projectBootstrap] \`${command}\` succeeded in ${elapsedSec}s: ${sidecar}`);
}

/** What sits at a prospective link path. */
function inspectLinkPath(link: string): 'link' | 'real' | 'absent' {
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
 * rmdir is the documented fallback for a junction that unlink refuses.
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
  logger.warn({ link }, '[projectBootstrap] Could not remove a stale node_modules link');
  return false;
}

/**
 * Link every node_modules the sidecar owns into the worktree.
 *
 * A pre-existing LINK is replaced (it may point at a stale tree); a real
 * directory is left alone — overwriting one would destroy an install.
 *
 * @returns Relative dirs that were linked / リンクした相対パス
 */
function linkSidecar(sidecar: string, worktree: string): string[] {
  const dirs: string[] = [];
  const walk = (rel: string, depth: number): void => {
    if (hasRealNodeModules(join(sidecar, rel))) dirs.push(rel);
    if (depth > SCAN_DEPTH) return;
    let children: string[];
    try {
      children = readdirSync(join(sidecar, rel), { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch {
      return;
    }
    for (const name of children) walk(rel ? `${rel}/${name}` : name, depth + 1);
  };
  walk('', 1);

  const linked: string[] = [];
  for (const rel of dirs) {
    const target = join(sidecar, rel, 'node_modules');
    const link = join(worktree, rel, 'node_modules');
    const existing = inspectLinkPath(link);
    if (existing === 'real') continue; // a real install here — never clobber it
    if (existing === 'link') {
      let sameTarget = false;
      try {
        sameTarget = readlinkSync(link) === target;
      } catch {
        /* unreadable link — treat as stale and replace */
      }
      if (sameTarget) {
        linked.push(rel);
        continue;
      }
      if (!removeLink(link)) continue; // could not clear it; leave as-is
    }
    try {
      mkdirSync(dirname(link), { recursive: true });
      // 'junction' is honored on Windows (no admin needed), ignored on POSIX.
      symlinkSync(target, link, 'junction');
      linked.push(rel);
    } catch (err) {
      logger.warn({ err, link, target }, '[projectBootstrap] Failed to link node_modules');
    }
  }
  return linked;
}

/**
 * Prepare dependencies for a worktree of a non-rapitas project.
 *
 * @param worktreePath - Absolute worktree path / worktree の絶対パス
 * @returns What was done, for logging and tests / 実施内容
 * @throws {Error} When an install was required and failed / インストール失敗時
 */
export async function bootstrapProjectDependencies(
  worktreePath: string,
): Promise<{ action: 'linked' | 'installed' | 'skipped'; detail: string }> {
  const root = projectRootOf(worktreePath);
  const manifests = collectManifests(worktreePath);
  if (manifests.length === 0) {
    logger.info(`[projectBootstrap] No manifest in ${worktreePath}; nothing to prepare`);
    return { action: 'skipped', detail: 'no manifest' };
  }

  const sidecar = join(root, SIDECAR_DIR);
  const fingerprintPath = join(sidecar, FINGERPRINT_FILE);
  const wanted = fingerprintManifests(worktreePath, manifests);
  let current = '';
  try {
    current = readFileSync(fingerprintPath, 'utf8').trim();
  } catch {
    /* no sidecar yet */
  }

  // Excluded on every run, not just on install: the sidecar may already exist
  // from an earlier run while this checkout's exclude file does not mention it.
  if (existsSync(sidecar)) excludeSidecar(root);

  let installed = false;
  if (current !== wanted || !hasRealNodeModules(sidecar)) {
    mkdirSync(sidecar, { recursive: true });
    excludeSidecar(root);
    await installSidecar(sidecar, worktreePath, manifests);
    writeFileSync(fingerprintPath, wanted, 'utf8');
    installed = true;
  }

  const linked = linkSidecar(sidecar, worktreePath);
  logger.info(
    `[projectBootstrap] ${installed ? 'installed + ' : ''}linked ${linked.length} node_modules into ${worktreePath}`,
  );
  return {
    action: installed ? 'installed' : 'linked',
    detail: `${linked.length} link(s): ${linked.map((r) => r || '.').join(', ')}`,
  };
}
