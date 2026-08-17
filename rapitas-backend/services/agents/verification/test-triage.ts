/**
 * test-triage
 *
 * Classifies test failures as "pre-existing" (existed before the agent's
 * changes) or "new" (agent-introduced) by running failing tests against the
 * merge-base worktree. Used by the verification gate to avoid false-blocking
 * on tests that were already red before the agent touched anything.
 *
 * Does not modify database state; concern filing is the caller's responsibility.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, relative } from 'path';
import { randomBytes } from 'crypto';
import { removeWorktree } from '../orchestrator/git-operations/worktree/worktree-ops';
import { createLogger } from '../../../config/logger';

const log = createLogger('agents:verification:test-triage');

/** Per-test-file timeout for individual triage runs. */
const TRIAGE_TEST_TIMEOUT_MS = 120_000;
const TRIAGE_CMD_TIMEOUT_MS = 10_000;

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runTriageCmd(
  command: string,
  cwd: string,
  timeoutMs: number = TRIAGE_CMD_TIMEOUT_MS,
): Promise<CmdResult> {
  return new Promise((resolveP) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveP({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish(124);
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', () => finish(1));
    child.on('close', (code) => finish(code ?? 0));
  });
}

/**
 * Classifies failing test files into pre-existing vs. new failures by comparing
 * against a baseline set. Pure function — no I/O; the eval-gates harness tests this.
 *
 * @param currentFailing - Test files failing in the agent's worktree / 現行の失敗ファイル
 * @param baselineFailing - Test files failing at merge-base / ベースラインの失敗ファイル
 * @returns Classification result / 分類結果
 */
export function classifyFailures(
  currentFailing: string[],
  baselineFailing: Set<string>,
): { preExisting: string[]; newFailures: string[] } {
  const preExisting = currentFailing.filter((f) => baselineFailing.has(f));
  const newFailures = currentFailing.filter((f) => !baselineFailing.has(f));
  return { preExisting, newFailures };
}

/** Resolves the merge-base commit the worktree branched from. Returns null when undetermined. */
async function resolveBaseCommit(workdir: string): Promise<string | null> {
  for (const candidate of ['develop', 'main', 'master']) {
    const res = await runTriageCmd(`git merge-base HEAD ${candidate}`, workdir);
    if (res.code === 0 && res.stdout.trim()) return res.stdout.trim();
  }
  return null;
}

/** Gets the main repository root by reading the first `git worktree list` entry. */
async function getMainRepoRoot(workdir: string): Promise<string | null> {
  const res = await runTriageCmd('git worktree list --porcelain', workdir);
  if (res.code !== 0) return null;
  const match = res.stdout.match(/^worktree (.+)$/m);
  return match ? match[1]!.trim() : null;
}

/**
 * Runs a single test file and returns whether it failed.
 * A timeout (exit code 124) is treated as NOT failing to avoid classifying
 * slow baseline tests as "pre-existing" when they actually timed out.
 */
async function isTestFileFailing(file: string, projectRoot: string): Promise<boolean> {
  const res = await runTriageCmd(
    `bun test --isolate "${file}"`,
    projectRoot,
    TRIAGE_TEST_TIMEOUT_MS,
  );
  return res.code !== 0 && res.code !== 124;
}

/** Creates a detached git worktree at the given commit. Returns true on success. */
async function defaultCreateWorktree(
  mainRepoRoot: string,
  baselineDir: string,
  baseCommit: string,
): Promise<boolean> {
  const res = await runTriageCmd(
    `git worktree add --detach "${baselineDir}" ${baseCommit}`,
    mainRepoRoot,
    30_000,
  );
  if (res.code !== 0) {
    log.warn({ err: res.stderr }, 'test-triage: git worktree add failed');
  }
  return res.code === 0;
}

/** Runs setup-worktree.cjs in a baseline worktree to link node_modules. Returns true on success. */
async function defaultSetupWorktree(baselineDir: string): Promise<boolean> {
  const setupScript = join(baselineDir, 'scripts', 'setup-worktree.cjs');
  if (!existsSync(setupScript)) {
    log.warn({ baselineDir }, 'test-triage: setup-worktree.cjs not found in baseline');
    return false;
  }
  const res = await runTriageCmd(`node "${setupScript}"`, baselineDir, 120_000);
  if (res.code !== 0) {
    log.warn({ err: res.stderr }, 'test-triage: setup-worktree.cjs failed in baseline');
  }
  return res.code === 0;
}

/**
 * Injectable dependencies for testing without real git/filesystem operations.
 * All fields are optional; omitting a field uses the real implementation.
 */
export interface TriageRunnerOpts {
  resolveBaseCommitFn?: (workdir: string) => Promise<string | null>;
  getMainRepoRootFn?: (workdir: string) => Promise<string | null>;
  isTestFileFailingFn?: (file: string, projectRoot: string) => Promise<boolean>;
  removeWorktreeFn?: (baseDir: string, path: string, deleteBranch: boolean) => Promise<void>;
  createWorktreeFn?: (mainRepoRoot: string, dir: string, commit: string) => Promise<boolean>;
  setupWorktreeFn?: (dir: string) => Promise<boolean>;
}

/**
 * Classifies failing tests as pre-existing or agent-introduced by running them
 * against the merge-base worktree. Returns null on infrastructure failure, in
 * which case the caller should treat all failures as new (fail-safe).
 *
 * Strategy (fail-safe on any infrastructure error):
 * 1. Run each scoped test individually to determine currentFailing.
 * 2. Create a detached worktree at merge-base and link node_modules.
 * 3. Run only the currently-failing files against the baseline.
 * 4. Classify via classifyFailures.
 *
 * @param projectRoot - Nearest package.json dir for running tests / テスト実行ルート
 * @param workdir - Agent's worktree root / エージェントの worktree ルート
 * @param scopedTestFiles - Test files in scope (relative to projectRoot) / スコープ内テスト
 * @param opts - Injectable dependencies for testing / テスト用依存性注入
 * @returns Classification or null on infrastructure failure / 分類結果、失敗時 null
 */
export async function triageTestFailures(
  projectRoot: string,
  workdir: string,
  scopedTestFiles: string[],
  opts?: TriageRunnerOpts,
): Promise<{ preExisting: string[]; newFailures: string[] } | null> {
  if (scopedTestFiles.length === 0) return { preExisting: [], newFailures: [] };

  const resolveBase = opts?.resolveBaseCommitFn ?? resolveBaseCommit;
  const getMainRoot = opts?.getMainRepoRootFn ?? getMainRepoRoot;
  const isFailing = opts?.isTestFileFailingFn ?? isTestFileFailing;
  const removeWt = opts?.removeWorktreeFn ?? removeWorktree;
  const createWt = opts?.createWorktreeFn ?? defaultCreateWorktree;
  const setupWt = opts?.setupWorktreeFn ?? defaultSetupWorktree;

  // Step 1: determine which scoped files are currently failing (1 file = 1 command)
  const currentFailing: string[] = [];
  for (const file of scopedTestFiles) {
    if (await isFailing(file, projectRoot)) {
      currentFailing.push(file);
    }
  }
  if (currentFailing.length === 0) return { preExisting: [], newFailures: [] };

  log.info({ currentFailing }, 'test-triage: found failing tests, starting baseline comparison');

  // Step 2: resolve merge-base commit and main repo root
  const baseCommit = await resolveBase(workdir);
  if (!baseCommit) {
    log.warn({ workdir }, 'test-triage: cannot resolve merge-base, treating all failures as new');
    return null;
  }
  const mainRepoRoot = await getMainRoot(workdir);
  if (!mainRepoRoot) {
    log.warn(
      { workdir },
      'test-triage: cannot resolve main repo root, treating all failures as new',
    );
    return null;
  }

  const baselineDir = join(mainRepoRoot, '.worktrees', `triage-${randomBytes(4).toString('hex')}`);
  let baselineCreated = false;

  try {
    // Step 3: create detached worktree at merge-base
    const created = await createWt(mainRepoRoot, baselineDir, baseCommit);
    if (!created) {
      log.warn(
        { baselineDir },
        'test-triage: baseline worktree creation failed, treating all failures as new',
      );
      return null;
    }
    baselineCreated = true;

    // Step 4: link node_modules via setup-worktree.cjs
    // NOTE: bun install is prohibited in worktrees per CLAUDE.md; setup-worktree.cjs only links.
    const setup = await setupWt(baselineDir);
    if (!setup) {
      log.warn({ baselineDir }, 'test-triage: baseline setup failed, treating all failures as new');
      return null;
    }

    // The baseline's project root mirrors the current worktree's structure
    const relProjectRoot = relative(workdir, projectRoot);
    const baselineProjectRoot = join(baselineDir, relProjectRoot);

    // Step 5: run each currently-failing file in the baseline to build baselineFailing
    const baselineFailing = new Set<string>();
    for (const file of currentFailing) {
      // NOTE: If the file doesn't exist in baseline the agent added it → new failure.
      const baselineFilePath = join(baselineProjectRoot, file);
      if (!existsSync(baselineFilePath)) continue;
      if (await isFailing(file, baselineProjectRoot)) {
        baselineFailing.add(file);
      }
    }

    const result = classifyFailures(currentFailing, baselineFailing);
    log.info(
      { preExisting: result.preExisting, newFailures: result.newFailures },
      'test-triage: classification complete',
    );
    return result;
  } catch (err) {
    log.warn({ err }, 'test-triage: unexpected error during triage, treating all failures as new');
    return null;
  } finally {
    if (baselineCreated) {
      // NOTE: deleteBranch=false — detached HEAD has no branch to delete.
      await removeWt(mainRepoRoot, baselineDir, false).catch((err: unknown) =>
        log.warn(
          { err, baselineDir },
          'test-triage: failed to remove baseline worktree (non-fatal)',
        ),
      );
    }
  }
}
