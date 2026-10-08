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
 * The layout is the ordinary one: `node_modules` at the PROJECT ROOT, installed
 * from the root's own manifests, with worktrees linked into it — the same shape
 * rapitas itself uses. The install runs only when the root's manifest
 * fingerprint changes, so adding a dependency triggers a reinstall and an
 * unchanged project does no work.
 *
 * An earlier revision installed into a gitignored `.rapitas-deps` sidecar built
 * from COPIED manifests, because a project scaffolded as docs-only has no root
 * manifest until its first PR merges. That was dropped: copying only the
 * manifests silently breaks every pnpm feature that references other files
 * (`patchedDependencies` and its patches/, `file:`/`link:` deps, per-package
 * `.npmrc`, overrides pointing at local files). The gap is closed at the source
 * instead — the generator now scaffolds the skeleton into the project root — and
 * {@link bootstrapProjectDependencies} keeps a legacy path for projects created
 * before that.
 *
 * NOT responsible for deciding whether a task needs dependencies
 * (`taskNeedsDependencies`) or for rapitas worktrees.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createLogger } from '../../../../../config/logger';
import { linkNodeModules, worktreeHasUsableModules, holdsRealInstall } from './node-modules-link';
import {
  collectManifests,
  fingerprintManifests,
  installInvocation,
  resolveInstallCommand,
} from './project-manifests';

const execAsync = promisify(exec);
const logger = createLogger('git-operations/project-dependency-bootstrap');

// A first install pulls the whole tree over the network; linking is seconds.
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const INSTALL_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * Where the installed fingerprint is recorded. Inside node_modules on purpose:
 * it is gitignored by every project by construction, and deleting node_modules
 * correctly invalidates it.
 */
const FINGERPRINT_FILE = join('node_modules', '.rapitas-deps-fingerprint');

/** What a bootstrap run did, for logging and tests. */
export interface BootstrapResult {
  action: 'installed' | 'linked' | 'skipped';
  detail: string;
}

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

/** Fingerprint recorded by the last successful install in `dir`. */
function recordedFingerprint(dir: string): string {
  try {
    return readFileSync(join(dir, FINGERPRINT_FILE), 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * Run the install in `dir`.
 *
 * @throws {Error} When the package manager exits non-zero / 非ゼロ終了時
 */
async function runInstall(dir: string): Promise<string> {
  const command = installInvocation(resolveInstallCommand(dir));
  const startedAt = Date.now();
  let output = '';
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: dir,
      encoding: 'utf8',
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: INSTALL_BUFFER_BYTES,
    });
    output = `${stdout}\n${stderr}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, `[projectBootstrap] \`${command}\` failed in ${dir}`);
    throw new Error(`${command} failed for ${dir}: ${message}`);
  }
  logger.info(
    `[projectBootstrap] \`${command}\` succeeded in ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${dir}`,
  );
  // Surfaced rather than swallowed: those packages are installed but NOT built,
  // so a runtime needing their native parts (prisma engines, argon2) still
  // fails until the project declares onlyBuiltDependencies.
  const ignored = /Ignored build scripts:([^\n]*)/.exec(output);
  if (ignored) {
    logger.warn(
      { dir, packages: ignored[1].trim() },
      '[projectBootstrap] Dependencies installed but their build scripts were skipped; declare onlyBuiltDependencies in the project manifest if a native build is required',
    );
  }
  return command;
}

/**
 * Install at the project root if its manifests changed or nothing is installed.
 *
 * @returns The command run, or null when the install was not needed / 実行したコマンド
 */
async function ensureRootInstall(root: string, manifests: string[]): Promise<string | null> {
  const wanted = fingerprintManifests(root, manifests);
  if (wanted === recordedFingerprint(root) && holdsRealInstall(root)) return null;
  const command = await runInstall(root);
  try {
    writeFileSync(join(root, FINGERPRINT_FILE), wanted, 'utf8');
  } catch (err) {
    // Non-fatal, but worth knowing: the next launch would reinstall.
    logger.warn({ err, root }, '[projectBootstrap] Could not record the install fingerprint');
  }
  return command;
}

/**
 * Prepare dependencies for a worktree of a non-rapitas project.
 *
 * @param worktreePath - Absolute worktree path / worktree の絶対パス
 * @returns What was done / 実施内容
 * @throws {Error} When an install was required and failed / インストール失敗時
 */
export async function bootstrapProjectDependencies(worktreePath: string): Promise<BootstrapResult> {
  const root = projectRootOf(worktreePath);

  // The normal path: the project root carries its own manifests.
  if (existsSync(join(root, 'package.json'))) {
    const installed = await ensureRootInstall(root, collectManifests(root));
    const linked = root === worktreePath ? [] : linkNodeModules(root, worktreePath);
    logger.info(
      `[projectBootstrap] ${installed ? 'installed + ' : ''}linked ${linked.length} node_modules into ${worktreePath}`,
    );
    return {
      action: installed ? 'installed' : 'linked',
      detail: `${linked.length} link(s): ${linked.map((r) => r || '.').join(', ') || 'none'}`,
    };
  }

  // Legacy path: a project scaffolded as docs-only has no root manifest until
  // its first PR merges, so the skeleton exists only on the task branch. Such a
  // worktree installs for itself once; later worktrees take the normal path.
  if (worktreeHasUsableModules(worktreePath)) {
    return { action: 'skipped', detail: 'worktree already has usable node_modules' };
  }
  if (!existsSync(join(worktreePath, 'package.json'))) {
    logger.info(`[projectBootstrap] No manifest in ${root} or ${worktreePath}; nothing to prepare`);
    return { action: 'skipped', detail: 'no manifest' };
  }
  logger.warn(
    { root, worktreePath },
    '[projectBootstrap] Project root has no manifest yet; installing inside the worktree this once',
  );
  const command = await runInstall(worktreePath);
  return { action: 'installed', detail: `${command} (in worktree; root not scaffolded yet)` };
}
