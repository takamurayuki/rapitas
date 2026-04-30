/**
 * GitOperations — Dependency Installer for Worktrees
 *
 * Installs JavaScript dependencies in newly-created git worktrees so that
 * agent-spawned commands (vitest, next, etc.) can resolve their CLI binaries
 * via node_modules/.bin. git worktree only checks out tracked files, so
 * node_modules (which is gitignored) does not propagate to the worktree.
 * Without this step, agents crash with "command not found" on the first test run.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../../../../config/logger';

const execAsync = promisify(exec);
const logger = createLogger('git-operations/dependency-installer');

// NOTE: pnpm offline install on a large monorepo dir can take ~30-60s on Windows
// due to per-file hardlink syscall overhead. 5 min ceiling avoids hanging the
// agent indefinitely while leaving plenty of headroom for slow disks.
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

const INSTALL_BUFFER_BYTES = 32 * 1024 * 1024;

/**
 * Install dependencies in every package.json-bearing directory of a worktree.
 *
 * Scans the worktree root and its first-level subdirectories for pairs of
 * `package.json` + `pnpm-lock.yaml` and runs `pnpm install --offline
 * --prefer-offline --frozen-lockfile` in each. Uses pnpm's content-addressable
 * store so the install requires no network and is dominated by hardlink creation.
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
    `[installWorktreeDependencies] Installing dependencies in ${targets.length} director${targets.length === 1 ? 'y' : 'ies'}: ${relativeTargets.join(', ')}`,
  );

  for (const target of targets) {
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
      logger.error({ err: error }, `[installWorktreeDependencies] Failed to install in ${target}`);
      throw new Error(`pnpm install failed in worktree subdirectory ${target}: ${message}`);
    }
  }
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
