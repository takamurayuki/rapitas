/**
 * GitOperations — Dependency Linker for Worktrees
 *
 * Makes JavaScript dependencies available inside a freshly-created git worktree
 * so agent-spawned commands (vitest, next, eslint, tsc, etc.) can resolve their
 * CLI binaries via node_modules/.bin. git worktree only checks out tracked
 * files, so node_modules (gitignored) does not propagate to the worktree.
 *
 * CRITICAL (see CLAUDE.md / ADR): a worktree SHARES the main checkout's
 * node_modules via links — we must NEVER run a package installer (npm / bun /
 * pnpm install) inside it. Doing so mutates the shared dependency tree and
 * causes cascading breakage in the main checkout and other worktrees. We
 * therefore delegate to `scripts/setup-worktree.cjs`, which links main's
 * node_modules / Prisma client and copies per-worktree .env files. It is
 * idempotent and installs nothing.
 *
 * Design:
 *   - Runs in the **background** (fire-and-track) so HTTP responses return
 *     immediately. Callers that need node_modules ready (the agent CLI
 *     launcher) await `awaitWorktreeDependencies(path)`.
 *   - A heuristic (`taskNeedsDependencies`) lets callers skip linking entirely
 *     for tasks that do not touch JS code (docs-only, etc.).
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../../../../config/logger';

const execAsync = promisify(exec);
const logger = createLogger('git-operations/dependency-installer');

// NOTE: linking is fast, but the main node_modules can be large; allow ample
// headroom on slow disks while still capping so a hung link can't block forever.
const SETUP_TIMEOUT_MS = 5 * 60 * 1000;

const SETUP_BUFFER_BYTES = 32 * 1024 * 1024;

// NOTE: Tracks in-flight (and recently completed) link promises by worktree
// path so multiple callers can `await` the same setup without re-running it.
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
 * @returns true if dependencies should be linked / 依存関係をリンクすべきならtrue
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
  // implementation language. These are the cases where we must link.
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
  // Ambiguous: default to linking for safety — better to link briefly than
  // to crash an agent with "command not found" mid-task.
  return true;
}

/**
 * Begin linking dependencies in the background. Idempotent per worktreePath.
 * Returns a promise that resolves when the link setup (or pre-existing one) finishes.
 *
 * @param worktreePath - Absolute path to the worktree root / worktreeのルート絶対パス
 * @returns Promise that settles when setup completes / セットアップ完了で解決するPromise
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
 * Wait for the in-flight link setup for a worktree, kicking one off if none is running.
 * Use this just before launching commands that need node_modules/.bin.
 *
 * @param worktreePath - Absolute path to the worktree root / worktreeのルート絶対パス
 * @returns Promise that settles when setup completes / セットアップ完了で解決するPromise
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
 * Make dependencies available in a worktree by LINKING the main checkout's
 * node_modules (via scripts/setup-worktree.cjs) — never by installing.
 *
 * NOTE: previously this ran `pnpm install --offline --frozen-lockfile` in each
 * package dir, which both violated the no-install-in-worktree rule and failed
 * outright whenever pnpm-lock.yaml drifted from package.json (frozen-lockfile),
 * leaving the agent CLI launcher (which awaits this) unable to start. Linking
 * sidesteps both problems.
 *
 * @param worktreePath - Absolute path to the worktree root / worktreeのルート絶対パス
 * @throws {Error} When setup-worktree.cjs fails / setup-worktree.cjs が失敗した場合
 */
export async function installWorktreeDependencies(worktreePath: string): Promise<void> {
  const scriptPath = join(worktreePath, 'scripts', 'setup-worktree.cjs');
  if (!existsSync(scriptPath)) {
    logger.warn(
      `[installWorktreeDependencies] setup-worktree.cjs not found at ${scriptPath}; skipping (node_modules link unavailable)`,
    );
    return;
  }

  const startedAt = Date.now();
  try {
    await execAsync(`node "${scriptPath}"`, {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: SETUP_TIMEOUT_MS,
      maxBuffer: SETUP_BUFFER_BYTES,
    });
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    logger.info(
      `[installWorktreeDependencies] Linked worktree dependencies via setup-worktree.cjs (${elapsedSec}s): ${worktreePath}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { err: error },
      `[installWorktreeDependencies] setup-worktree.cjs failed for ${worktreePath}`,
    );
    throw new Error(`setup-worktree.cjs failed for worktree ${worktreePath}: ${message}`);
  }
}
