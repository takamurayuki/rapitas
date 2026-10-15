/**
 * worktree-preflight
 *
 * Environment preflight for a freshly created (or reused) agent worktree.
 * Runs the repo's `scripts/setup-worktree.cjs` automatically when present —
 * until now this was a manual rule in CLAUDE.md that agents had to remember,
 * and a forgotten run produced worktrees without linked node_modules where the
 * agent flailed and the verifier failed closed AFTER tokens were burned.
 * Projects with no such script are prepared by `bootstrapProjectDependencies`
 * instead. Fails fast (throws) only for a MANAGED environment that is broken.
 * Not responsible for creating or removing worktrees.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createLogger } from '../../../../../config/logger';

const execAsync = promisify(exec);
const logger = createLogger('worktree-preflight');

/** setup-worktree links node_modules/.env/prisma artifacts; allow it time. */
const SETUP_TIMEOUT_MS = 120_000;

/** Injectable pieces of {@link preflightWorktree}; tests avoid a real install. */
export interface PreflightOpts {
  /** Prepares a non-rapitas project's dependencies. / 非 rapitas プロジェクトの依存を準備 */
  bootstrap?: (worktreePath: string) => Promise<unknown>;
}

/**
 * Prepares and validates a worktree's environment before any agent runs in it.
 *
 * - `scripts/setup-worktree.cjs` present → run it (idempotent by contract) and
 *   then REQUIRE root node_modules to exist; throw with an actionable message
 *   otherwise. Spawning an agent into a known-broken managed env only burns
 *   tokens before the verifier fails closed.
 * - No setup script → prepare the dependencies ourselves (install at the
 *   project ROOT, then link into the worktree), and only warn if that fails.
 *
 * Why the second branch does work now. `bootstrapProjectDependencies` already
 * did exactly the right thing, but its only production caller was test-triage,
 * so nothing prepared a worktree at creation time: measured 2026-10-13, the
 * backend logged `projectBootstrap` 0 times against 3 `node_modules is absent`
 * warnings. ContextFlow #1215 then started with no dependencies at all — its
 * runtime-smoke could not resolve `next`, reported `unverifiable; completion
 * withheld`, and the agent spent 07:13–07:19 installing 403MB by hand. A
 * warning no one reads is not plumbing.
 *
 * A failure here warns instead of throwing: an unmanaged project must not be
 * hard-blocked by a package-manager fault, because the agent can still install
 * for itself, as it had to before this path existed.
 *
 * @param worktreePath - The worktree to prepare / 準備対象の worktree
 * @param opts - Injectable dependency preparation / テスト用の注入
 * @throws {Error} When the managed setup fails or leaves dependencies missing. / 管理済み環境が壊れている場合
 */
export async function preflightWorktree(
  worktreePath: string,
  opts: PreflightOpts = {},
): Promise<void> {
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

  if (!hasPackageJson) return;

  try {
    // Imported on demand, not at module scope: this chain reaches a package
    // manager and the project's Prisma client, and the managed-setup path above
    // — which is every rapitas worktree — needs none of it.
    const { worktreeHasUsableModules } = await import('./node-modules-link');
    // Not existsSync: #1215's worktree HAD a node_modules, holding only pnpm's
    // store, which resolves nothing.
    if (worktreeHasUsableModules(worktreePath)) return;

    const bootstrap =
      opts.bootstrap ??
      (await import('./project-dependency-bootstrap')).bootstrapProjectDependencies;
    const result = await bootstrap(worktreePath);
    logger.info({ worktreePath, result }, '[preflight] prepared the project dependencies');
  } catch (err) {
    logger.warn(
      { err, worktreePath },
      '[preflight] could not prepare the project dependencies — the agent may have to ' +
        'install for itself, and verification may report unverifiable until it does',
    );
  }
}
