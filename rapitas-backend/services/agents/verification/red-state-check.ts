/**
 * red-state-check
 *
 * Verifies TDD's other half: automated-verifier.ts's coverageCheck only
 * proves "a test file changed" (presence), not that the test was written
 * FIRST — a test added after the fact, which would pass with or without the
 * implementation, satisfies coverage identically to a genuine RED→GREEN test.
 * This module proves the test is genuinely RED without the implementation:
 * it seeds a disposable, detached worktree at the task's diff base with the
 * task's CURRENT test-file content (but base-ref source files) and runs just
 * those tests there. If they PASS without the fix, the test isn't testing
 * the new behavior and the check fails; if they fail (as a real RED test
 * must), the check passes. The task's own worktree is never mutated — this
 * check only ever reads from it and writes into the disposable one — so a
 * bug here can delay a completion, never corrupt in-progress work. Not
 * responsible for deciding whether tests are required at all (see
 * automated-verifier.ts's coverageCheck / requiresTestsForTask) or for
 * choosing which files count as "test files" (related-tests.ts's TEST_FILE_RE).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createLogger } from '../../../config/logger';
import { WORKTREE_DIR } from '../orchestrator/git-operations/core/safety';
import { removeWorktree } from '../orchestrator/git-operations/worktree/worktree-remove';
import { buildFileScopedCommand, TEST_FILE_RE } from './related-tests';
import { spawnQuiet } from './quiet-verification';
import { diffBaseRef, type VerificationCheck } from './automated-verifier';

const execFileAsync = promisify(execFile);
const log = createLogger('agents:verification:red-state-check');

const GIT_OP_TIMEOUT_MS = 60_000;
const SETUP_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 180_000;
const MAX_DETAIL_CHARS = 4000;

/** Runs `git` with array args (no shell) in `cwd`; never throws. */
async function git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_OP_TIMEOUT_MS,
      windowsHide: true,
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: '' };
  }
}

/**
 * The main repository root that owns `workdir`'s linked worktrees — where
 * `.worktrees/` (and the shared `.git`) live. Returns null on failure (the
 * caller fails open).
 */
async function resolveMainRepoRoot(workdir: string): Promise<string | null> {
  const common = await git(workdir, ['rev-parse', '--git-common-dir']);
  if (!common.ok || !common.stdout.trim()) return null;
  let commonDir = common.stdout.trim().replace(/\\/g, '/');
  if (!/^([a-zA-Z]:)?\//.test(commonDir)) commonDir = resolve(workdir, commonDir);
  // --git-common-dir points AT the shared .git directory; its parent is the
  // main repo root (the standard, non-bare layout this project uses).
  return dirname(commonDir);
}

/** Runs a shell command, capturing exit code — never rejects. */
function runShell(command: string, cwd: string, timeoutMs: number): Promise<number> {
  return new Promise((resolveP) => {
    let settled = false;
    const child = spawnQuiet(command, { cwd, shell: true, windowsHide: true });
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveP(code);
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish(124);
    }, timeoutMs);
    child.on('error', () => finish(1));
    child.on('close', (code) => finish(code ?? 0));
  });
}

/**
 * Copies `testFiles`' CURRENT content (from the task's own worktree — may be
 * uncommitted/untracked, which is exactly the state we need to check) into
 * the same repo-relative paths inside the scratch worktree. A plain read+write,
 * not a git operation, so it works regardless of tracked/staged state.
 */
function seedTestFiles(taskWorkdir: string, scratchWorkdir: string, testFiles: string[]): void {
  for (const relPath of testFiles) {
    const src = join(taskWorkdir, relPath);
    if (!existsSync(src)) continue; // deleted test file — nothing to seed
    const dst = join(scratchWorkdir, relPath);
    mkdirSync(dirname(dst), { recursive: true });
    // Read+write (not copyFileSync) so we never open a second handle on a
    // file the implementer's own process might still have open for writing.
    const content = readFileSync(src);
    writeFileSync(dst, content);
  }
}

/**
 * Verifies that `testFiles` (already known to have changed — the caller
 * filters via TEST_FILE_RE) genuinely fail when run against the diff's BASE
 * source code, proving they test the new behavior rather than having been
 * written after the fact. Runs in a disposable, detached worktree seeded
 * with base-ref sources + current test content; the task's own worktree is
 * never touched. Every infrastructure failure (worktree add, dependency
 * link, timeout) fails OPEN (returns null, excluded from the gate) — only a
 * confirmed "the test passed without the fix" is a real gate failure.
 *
 * @param taskWorkdir - The task's own git worktree (read-only here). / タスク自身のworktree（読み取り専用）
 * @param baseRef - The diff's base commit (automated-verifier.ts's diffBaseRef). / 差分の基準コミット
 * @param testFiles - Changed test files, repo-relative to taskWorkdir. / 変更されたテストファイル（相対パス）
 * @returns A 'red-state' check, or null when not applicable / infra failed (fail-open). / redステート判定、または対象外・実行不能時null
 */
export async function redStateCheck(
  taskWorkdir: string,
  baseRef: string,
  testFiles: string[],
): Promise<VerificationCheck | null> {
  if (testFiles.length === 0) return null;

  const mainRepoRoot = await resolveMainRepoRoot(taskWorkdir);
  if (!mainRepoRoot) {
    log.warn({ taskWorkdir }, '[red-state-check] Could not resolve main repo root — skipping');
    return null;
  }

  const scratchDir = join(mainRepoRoot, WORKTREE_DIR, `redcheck-${randomBytes(6).toString('hex')}`);
  let created = false;
  try {
    const add = await git(mainRepoRoot, [
      'worktree',
      'add',
      '--detach',
      '--quiet',
      scratchDir,
      baseRef,
    ]);
    if (!add.ok) {
      log.warn({ baseRef }, '[red-state-check] git worktree add failed — skipping (fail-open)');
      return null;
    }
    created = true;

    const setupScript = join(scratchDir, 'scripts', 'setup-worktree.cjs');
    if (existsSync(setupScript)) {
      try {
        await execFileAsync(process.execPath, [setupScript, scratchDir], {
          cwd: mainRepoRoot,
          encoding: 'utf8',
          timeout: SETUP_TIMEOUT_MS,
        });
      } catch (err) {
        log.warn({ err }, '[red-state-check] setup-worktree.cjs failed — skipping (fail-open)');
        return null;
      }
    }

    seedTestFiles(taskWorkdir, scratchDir, testFiles);
    // Commit the seed so the scratch worktree is clean before teardown —
    // removeWorktree refuses to delete a worktree with uncommitted content
    // (a real safeguard against destroying in-progress work elsewhere; here
    // it would otherwise always trip, since the seeded files are never
    // staged). A throwaway commit on a detached, disposable worktree that is
    // removed a few lines below, so hooks add nothing but latency/risk here.
    await git(scratchDir, ['add', '-A']);
    await git(scratchDir, [
      'commit',
      '--quiet',
      '--no-verify',
      '-m',
      'red-state-check: scratch seed',
    ]);

    // Group by project root exactly like the real test run does (a monorepo
    // change can span rapitas-backend/rapitas-frontend, each with its own
    // runner/config) — reuse automated-verifier.ts's own grouping so this
    // check's scope always matches the real coverage check's scope.
    const { groupByProjectRoot } = await import('./automated-verifier');
    const groups = groupByProjectRoot(scratchDir, testFiles);

    const stillPassing: string[] = [];
    const genuinelyRed: string[] = [];
    let ranAny = false;
    for (const [projectRoot, relFiles] of groups) {
      const relToProject = relFiles.map((f) =>
        relative(projectRoot, join(scratchDir, f)).replace(/\\/g, '/'),
      );
      if (relToProject.length === 0) continue;
      const command = buildFileScopedCommand(projectRoot, relToProject);
      ranAny = true;
      const code = await runShell(command, projectRoot, TEST_TIMEOUT_MS);
      if (code === 124) {
        log.warn(
          { projectRoot },
          '[red-state-check] scoped test run timed out — skipping (fail-open)',
        );
        return null;
      }
      if (code === 0) stillPassing.push(...relFiles);
      else genuinelyRed.push(...relFiles);
    }
    if (!ranAny) return null;

    const ok = stillPassing.length === 0;
    return {
      name: 'red-state',
      ran: true,
      ok,
      errorCount: stillPassing.length,
      details: ok
        ? `red-state: ${genuinelyRed.length} test file(s) confirmed to fail without this diff's source changes (genuine RED)`
        : `以下のテストは本差分のソース変更を除いた状態（差分基準コミット）でも成功しました。実装より先に書かれた、あるいは新しい振る舞いを実際には検証していないテストの可能性があります:\n${stillPassing
            .slice(0, 20)
            .join('\n')}`.slice(0, MAX_DETAIL_CHARS),
    };
  } catch (err) {
    log.warn({ err }, '[red-state-check] Unexpected error — skipping (fail-open)');
    return null;
  } finally {
    if (created) {
      const removed = await removeWorktree(mainRepoRoot, scratchDir, false).catch(() => false);
      if (!removed) {
        log.warn(
          { scratchDir },
          '[red-state-check] Scratch worktree cleanup failed — left for the cleanup scheduler',
        );
      }
    }
  }
}

/**
 * Entry point for runAutomatedVerification: decides whether a red-state check
 * is worth running at all, and if so resolves the diff base and the changed
 * test files itself so the caller only has to pass through its own inputs.
 * Skipped entirely unless coverageCheck found ≥1 test file (coverage.ok) —
 * with no test present (or the requirement disabled), coverage already fails
 * or the check is opted out, so the worktree-add/setup/test overhead here
 * would add nothing.
 *
 * @param workdir - The agent's git worktree. / エージェントのworktree
 * @param changedFiles - Changed code files from getChangedCodeFiles. / 変更されたコードファイル
 * @param coverage - The coverageCheck result for this run (or null if disabled). / coverageCheckの結果
 * @param preferredBaseBranch - Passed through to diffBaseRef. / diffBaseRefへ引き渡す分岐元ブランチ
 * @returns A 'red-state' check, or null when skipped / not applicable. / redステート判定、またはnull
 */
export async function maybeRunRedStateCheck(
  workdir: string,
  changedFiles: string[],
  coverage: VerificationCheck | null,
  preferredBaseBranch?: string | null,
): Promise<VerificationCheck | null> {
  if (!coverage?.ok) return null;
  const testFiles = changedFiles.filter((f) => TEST_FILE_RE.test(f));
  if (testFiles.length === 0) return null;
  const baseRef = await diffBaseRef(workdir, preferredBaseBranch);
  return redStateCheck(workdir, baseRef, testFiles);
}
