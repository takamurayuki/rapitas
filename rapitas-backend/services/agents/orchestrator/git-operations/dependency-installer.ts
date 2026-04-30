/**
 * GitOperations — Dependency Installer for Worktrees
 *
 * Installs JavaScript dependencies in newly-created git worktrees so that
 * agent-spawned commands (vitest, next, etc.) can resolve their CLI binaries
 * via node_modules/.bin. git worktree only checks out tracked files, so
 * node_modules (which is gitignored) does not propagate to the worktree.
 *
 * Design:
 *   - Installs run in **parallel** across all package.json directories.
 *   - Installs run in the **background** (fire-and-track) so HTTP responses
 *     return immediately. Callers that need node_modules ready (the agent
 *     CLI launcher) await `awaitWorktreeDependencies(path)`.
 *   - A heuristic (`taskNeedsDependencies`) lets callers skip the install
 *     entirely for tasks that do not touch JS code (docs-only, etc.).
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../../../../config/logger';

const execAsync = promisify(exec);
const logger = createLogger('git-operations/dependency-installer');

const IS_WINDOWS = process.platform === 'win32';

// NOTE: After install, native .exe / .node files hardlinked from the pnpm store
// are scanned by Windows Defender (and other AV). During this scan, child_process
// spawn of those binaries fails with EPERM. We verify a canary binary executes
// successfully — retrying for up to ~10s — before reporting install complete.
const BINARY_WARMUP_RETRIES = 10;
const BINARY_WARMUP_DELAY_MS = 1000;

// NOTE: pnpm offline install on a large monorepo dir can take ~30-60s on Windows
// due to per-file hardlink syscall overhead. 5 min ceiling avoids hanging the
// agent indefinitely while leaving plenty of headroom for slow disks.
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

const INSTALL_BUFFER_BYTES = 32 * 1024 * 1024;

// NOTE: Tracks in-flight (and recently completed) install promises by worktree
// path so multiple callers can `await` the same install without re-running it.
// Entries are cleared via `clearWorktreeDependenciesTracking` when the worktree
// is removed, so this Map cannot leak across tasks.
const inflightInstalls = new Map<string, Promise<void>>();

/**
 * Heuristic: does this task likely need node_modules?
 *
 * Returns false only when the title/description strongly suggests a non-code
 * change (docs, comments, README/markdown only). Defaults to true so we never
 * cause an "command not found" failure for an ambiguous task.
 *
 * @param taskTitle - Task title / タスクタイトル
 * @param taskDescription - Task description / タスク説明
 * @returns true if dependencies should be installed / 依存関係をインストールすべきならtrue
 */
export function taskNeedsDependencies(taskTitle: string, taskDescription?: string | null): boolean {
  const haystack = `${taskTitle} ${taskDescription ?? ''}`.toLowerCase();

  // Strong docs-only indicators: high confidence the task does not touch JS code.
  const strongDocsPatterns: RegExp[] = [
    /\b(readme|markdown|typos?|jsdoc)\b/,
    /\bdocs?\b/,
    /\bcomments?\b/,
    /ドキュメント(?:のみ|だけ|更新|修正)/,
    /コメント(?:のみ|だけ|追加|修正)/,
    /readme(?:を|の)/,
    /誤字(?:脱字)?/,
    /タイポ/,
    /翻訳(?:のみ|だけ|追加|修正)/,
  ];

  // Strong code indicators: tests, builds, refactors, file extensions, explicit
  // implementation language. These are the cases where we must install.
  const strongCodePatterns: RegExp[] = [
    /\b(test|tests|spec|specs|unit\s+tests?|integration\s+tests?)\b/,
    /\b(build|bundle|compile|transpile)\b/,
    /\b(refactor|implement|migrate|feature|features)\b/,
    /\.(ts|tsx|js|jsx|cjs|mjs|css|scss)\b/,
    /(実装|機能追加|機能実装|リファクタ|テスト追加|ビルド)/,
  ];

  const looksLikeStrongCode = strongCodePatterns.some((pattern) => pattern.test(haystack));
  const looksDocsOnly = strongDocsPatterns.some((pattern) => pattern.test(haystack));

  // NOTE: Strong code wins over strong docs (e.g., "update README and add tests").
  if (looksLikeStrongCode) return true;
  if (looksDocsOnly) return false;
  // Ambiguous: default to install for safety — better to install briefly than
  // to crash an agent with "command not found" mid-task.
  return true;
}

/**
 * Begin installing dependencies in the background. Idempotent per worktreePath.
 * Returns a promise that resolves when the install (or pre-existing install) finishes.
 *
 * @param worktreePath - Absolute path to the worktree root / worktreeのルート絶対パス
 * @returns Promise that settles when install completes / インストール完了で解決するPromise
 */
export function startWorktreeDependenciesInstall(worktreePath: string): Promise<void> {
  const existing = inflightInstalls.get(worktreePath);
  if (existing) {
    return existing;
  }
  const promise = installWorktreeDependencies(worktreePath).catch((error) => {
    // NOTE: Drop failed promises from the map so a retry can re-attempt cleanly.
    inflightInstalls.delete(worktreePath);
    throw error;
  });
  inflightInstalls.set(worktreePath, promise);
  return promise;
}

/**
 * Wait for the in-flight install for a worktree, kicking one off if none is running.
 * Use this just before launching commands that need node_modules/.bin.
 *
 * @param worktreePath - Absolute path to the worktree root / worktreeのルート絶対パス
 * @returns Promise that settles when install completes / インストール完了で解決するPromise
 */
export function awaitWorktreeDependencies(worktreePath: string): Promise<void> {
  return startWorktreeDependenciesInstall(worktreePath);
}

/**
 * Drop tracking for a worktree (call after the worktree is removed).
 *
 * @param worktreePath - Worktree path that was removed / 削除されたworktreeのパス
 */
export function clearWorktreeDependenciesTracking(worktreePath: string): void {
  inflightInstalls.delete(worktreePath);
}

/**
 * Install dependencies in every package.json-bearing directory of a worktree.
 *
 * Scans the worktree root and its first-level subdirectories for pairs of
 * `package.json` + `pnpm-lock.yaml` and runs `pnpm install --offline
 * --prefer-offline --frozen-lockfile` in **parallel** across all of them.
 * Uses pnpm's content-addressable store so the install requires no network
 * and is dominated by hardlink creation.
 *
 * @param worktreePath - Absolute path to the worktree root / worktreeのルート絶対パス
 * @throws {Error} When pnpm install fails in any directory / いずれかのディレクトリでpnpm installが失敗した場合
 */
export async function installWorktreeDependencies(worktreePath: string): Promise<void> {
  const targets = await findPackageDirectories(worktreePath);

  if (targets.length === 0) {
    logger.info(
      `[installWorktreeDependencies] No package.json + pnpm-lock.yaml pairs found in ${worktreePath}, skipping`,
    );
    return;
  }

  const relativeTargets = targets.map((t) => t.replace(worktreePath, '.') || '.');
  logger.info(
    `[installWorktreeDependencies] Installing dependencies in ${targets.length} director${targets.length === 1 ? 'y' : 'ies'} (parallel): ${relativeTargets.join(', ')}`,
  );

  await Promise.all(
    targets.map(async (target) => {
      const startedAt = Date.now();
      try {
        await execAsync('pnpm install --offline --prefer-offline --frozen-lockfile', {
          cwd: target,
          encoding: 'utf8',
          timeout: INSTALL_TIMEOUT_MS,
          maxBuffer: INSTALL_BUFFER_BYTES,
        });
        const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
        logger.info(`[installWorktreeDependencies] Installed in ${target} (${elapsedSec}s)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          { err: error },
          `[installWorktreeDependencies] Failed to install in ${target}`,
        );
        throw new Error(`pnpm install failed in worktree subdirectory ${target}: ${message}`);
      }
    }),
  );

  if (IS_WINDOWS) {
    await waitForBinariesUsable(targets);
  }
}

/**
 * Block until canary native binaries (esbuild) can be spawned without EPERM.
 *
 * On Windows, hardlinked .exe files from pnpm's content-addressable store are
 * locked by Windows Defender for several seconds after install. The agent CLI
 * (vitest, next, etc.) spawning esbuild during this window fails with EPERM.
 *
 * @param targets - Directories where install just completed / インストール直後のディレクトリ
 */
async function waitForBinariesUsable(targets: string[]): Promise<void> {
  const canaries = targets.flatMap((target) => findCanaryBinaries(target));
  if (canaries.length === 0) return;

  for (let attempt = 0; attempt < BINARY_WARMUP_RETRIES; attempt++) {
    const allReady = await Promise.all(
      canaries.map((binary) =>
        execAsync(`"${binary}" --version`, { timeout: 5000, encoding: 'utf8' })
          .then(() => true)
          .catch(() => false),
      ),
    );
    if (allReady.every(Boolean)) {
      if (attempt > 0) {
        logger.info(
          `[waitForBinariesUsable] Native binaries usable after ${(attempt * BINARY_WARMUP_DELAY_MS) / 1000}s`,
        );
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, BINARY_WARMUP_DELAY_MS));
  }

  // NOTE: Don't throw — installs already succeeded. Log a warning so a slow AV
  // host shows up in logs but the agent still attempts to run.
  logger.warn(
    `[waitForBinariesUsable] Native binaries still not usable after ${BINARY_WARMUP_RETRIES * BINARY_WARMUP_DELAY_MS}ms; continuing anyway`,
  );
}

/**
 * Locate the platform-native esbuild binary inside an installed directory.
 * Returns paths only for binaries that physically exist.
 *
 * @param target - Installed directory containing node_modules / node_modulesを含むディレクトリ
 * @returns Existing binary paths to verify / 検証する存在するバイナリパス
 */
function findCanaryBinaries(target: string): string[] {
  const pnpmDir = join(target, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return [];

  const candidates: string[] = [];
  // NOTE: We only care about esbuild here — it's the most common Windows
  // EPERM offender (used by vitest, next, vite, tsx, storybook). Other native
  // deps (sharp's .node, swc's .node) are dynamically loaded via
  // require() and don't go through child_process.spawn, so AV locks don't
  // surface as visible errors.
  let entries: string[] = [];
  try {
    entries = readdirSync(pnpmDir);
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.startsWith('@esbuild+win32-x64@')) continue;
    const exePath = join(pnpmDir, entry, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');
    if (existsSync(exePath)) {
      candidates.push(exePath);
    }
  }
  return candidates;
}

/**
 * Find directories that have both a package.json and a pnpm-lock.yaml.
 * pnpm-lock.yaml is required because we use --frozen-lockfile.
 * Scans the root and one level of subdirectories (e.g., rapitas-frontend, rapitas-backend).
 *
 * @param worktreePath - Absolute path to scan / 走査する絶対パス
 * @returns Directories that contain both files / 両方のファイルを含むディレクトリ
 */
async function findPackageDirectories(worktreePath: string): Promise<string[]> {
  const targets: string[] = [];

  if (hasInstallableManifest(worktreePath)) {
    targets.push(worktreePath);
  }

  try {
    const entries = await fsPromises.readdir(worktreePath, { withFileTypes: true });
    for (const entry of entries) {
      // NOTE: Skip dotfiles, node_modules (already excluded but defensive),
      // and worktree metadata dirs.
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }
      const subdir = join(worktreePath, entry.name);
      if (hasInstallableManifest(subdir)) {
        targets.push(subdir);
      }
    }
  } catch (error) {
    logger.warn(
      { err: error },
      `[findPackageDirectories] Failed to read directory ${worktreePath}`,
    );
  }

  return targets;
}

function hasInstallableManifest(directory: string): boolean {
  return (
    existsSync(join(directory, 'package.json')) && existsSync(join(directory, 'pnpm-lock.yaml'))
  );
}
