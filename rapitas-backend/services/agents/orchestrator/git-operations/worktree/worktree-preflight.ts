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
  /** Copies scripts/run-checked.cjs into the worktree. / 検査ラッパーを配置 */
  wrapper?: (worktreePath: string) => Promise<unknown>;
}

/**
 * Put rapitas's `scripts/run-checked.cjs` into a worktree that lacks it.
 *
 * NOTE: Every implementer and verifier prompt says to verify through that
 * wrapper, and only the manual execute route copied it in, so an auto-run
 * worktree of a generated project never had it — task 1512 stopped to ask
 * for a check environment (2026-11-20). Warns instead of throwing, like the
 * dependency preparation.
 */
async function ensureWrapper(worktreePath: string, opts: PreflightOpts): Promise<void> {
  try {
    if (opts.wrapper) {
      await opts.wrapper(worktreePath);
      return;
    }
    const { ensureRunCheckedWrapper, defaultWrapperSource } =
      await import('./worktree-command-wrapper');
    await ensureRunCheckedWrapper(worktreePath, defaultWrapperSource(import.meta.dir));
  } catch (err) {
    logger.warn({ err, worktreePath }, '[preflight] could not place scripts/run-checked.cjs');
  }
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
/**
 * Whether any directory below the root holds a package.json.
 *
 * Imported on demand like the bootstrap below: the scan reads directories,
 * and the rapitas path that returns earlier never needs it.
 */
async function hasSubPackageManifest(worktreePath: string): Promise<boolean> {
  const { collectManifests } = await import('./project-manifests');
  return collectManifests(worktreePath).some((m) => m.includes('/'));
}

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

  // Before the manifest checks: a Go-only project still verifies through it.
  await ensureWrapper(worktreePath, opts);

  // NOTE: Sub-package manifests count too. trendline is a Go root with only
  // web/package.json; returning on "no root package.json" skipped the
  // bootstrap whose sub-package link (#1623) exists for exactly that layout,
  // so every task worktree started without web/node_modules (2026-11-20).
  if (!hasPackageJson && !(await hasSubPackageManifest(worktreePath))) return;

  try {
    // Imported on demand, not at module scope: this chain reaches a package
    // manager and the project's Prisma client, and the managed-setup path above
    // — which is every rapitas worktree — needs none of it.
    const { rootNeedsRelink, worktreeHasUsableModules, packagesNeedRelink } =
      await import('./node-modules-link');
    const { projectRootOf } = await import('./node-modules-workspace-links');
    // Not existsSync: #1215's worktree HAD a node_modules, holding only pnpm's
    // store, which resolves nothing.
    // Root modules say nothing about web/node_modules, so only a root package
    // may stop here; linking an already-linked sub-package is a no-op.
    // A usable root may still have a shape pnpm 12 refuses (one junction from
    // before #1717, or a linked state directory); re-link those (2026-11-24).
    // Package-level node_modules count too: one left as a junction to the main
    // tree, or holding a workspace link into it, makes build/E2E read the main
    // sources (TempoRaid 1420, 2026-11-24).
    if (
      hasPackageJson &&
      worktreeHasUsableModules(worktreePath) &&
      !rootNeedsRelink(worktreePath) &&
      !packagesNeedRelink(projectRootOf(worktreePath), worktreePath)
    ) {
      return;
    }

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

/**
 * Prepare a worktree that is being reused, then hand its path back.
 *
 * NOTE: Reuse used to return before any preflight, so a worktree created
 * before a fix stayed broken for every later phase (trendline 1511/1512 had
 * no web/node_modules, 2026-11-20). Unlike creation, a failure here only
 * warns: the worktree already exists and the agent can still work in it.
 *
 * @param worktreePath - The reused worktree / 再利用する worktree
 * @param opts - Injectable dependency preparation / テスト用の注入
 * @returns The same path / 同じパス
 */
export async function preflightReusedWorktree(
  worktreePath: string,
  opts: PreflightOpts = {},
): Promise<string> {
  try {
    await preflightWorktree(worktreePath, opts);
  } catch (err) {
    logger.warn({ err, worktreePath }, '[preflight] reused worktree could not be prepared');
  }
  return worktreePath;
}
