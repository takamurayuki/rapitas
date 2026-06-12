/**
 * worktree-preflight
 *
 * Environment preflight for a freshly created (or reused) agent worktree.
 * Runs the repo's `scripts/setup-worktree.cjs` automatically when present —
 * until now this was a manual rule in CLAUDE.md that agents had to remember,
 * and a forgotten run produced worktrees without linked node_modules where the
 * agent flailed and the verifier failed closed AFTER tokens were burned.
 * Fails fast (throws) only for a MANAGED environment that is broken; repos
 * without a setup script merely log a warning. Not responsible for creating
 * or removing worktrees.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createLogger } from '../../../../config/logger';

const execAsync = promisify(exec);
const logger = createLogger('worktree-preflight');

/** setup-worktree links node_modules/.env/prisma artifacts; allow it time. */
const SETUP_TIMEOUT_MS = 120_000;

/**
 * Prepares and validates a worktree's environment before any agent runs in it.
 *
 * - `scripts/setup-worktree.cjs` present → run it (idempotent by contract) and
 *   then REQUIRE root node_modules to exist; throw with an actionable message
 *   otherwise. Spawning an agent into a known-broken managed env only burns
 *   tokens before the verifier fails closed.
 * - No setup script → warn when node_modules is absent (a fresh worktree never
 *   has one), but do not block: unmanaged repos may install deps themselves or
 *   resolve tooling from the main checkout.
 *
 * @param worktreePath - The worktree to prepare / 準備対象の worktree
 * @throws {Error} When the managed setup fails or leaves dependencies missing. / 管理済み環境が壊れている場合
 */
export async function preflightWorktree(worktreePath: string): Promise<void> {
  const setupScript = join(worktreePath, 'scripts', 'setup-worktree.cjs');
  const hasPackageJson = existsSync(join(worktreePath, 'package.json'));
  const hasNodeModules = () => existsSync(join(worktreePath, 'node_modules'));

  if (existsSync(setupScript)) {
    try {
      await execAsync(`node "${setupScript}"`, {
        cwd: worktreePath,
        timeout: SETUP_TIMEOUT_MS,
        windowsHide: true,
      });
      logger.info({ worktreePath }, '[preflight] setup-worktree.cjs completed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `worktree のセットアップ (scripts/setup-worktree.cjs) に失敗しました。` +
          `エージェント実行を中止します（壊れた環境で実行してもトークンを浪費するだけのため）: ${msg}`,
      );
    }
    if (hasPackageJson && !hasNodeModules()) {
      throw new Error(
        'setup-worktree.cjs は完了しましたが node_modules がリンクされていません。' +
          'メインチェックアウトで依存をインストールしてから再実行してください。',
      );
    }
    return;
  }

  if (hasPackageJson && !hasNodeModules()) {
    logger.warn(
      { worktreePath },
      '[preflight] node_modules is absent and no setup-worktree.cjs exists — ' +
        'tooling may be unresolvable in this worktree',
    );
  }
}
