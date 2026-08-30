/**
 * auto-merge-checks
 *
 * Read-side helpers for the AutoMergeWatcher: querying a PR's CI checks, its
 * GitHub merge state, and its head commit via the `gh` CLI, plus the pure
 * aggregate-state evaluation of blocking checks. NOT responsible for any
 * merge/notify/persistence side effects — those live in auto-merge-watcher.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../../config/logger';

const execAsync = promisify(exec);
const log = createLogger('workflow:auto-merge-checks');

/**
 * Checks that GATE the merge. A PR merges only when every present blocking check
 * passes; advisory checks (bundle size, performance, CodeQL, previews) are
 * ignored. Overridable via RAPITAS_AUTOMERGE_CHECKS (comma-separated names).
 */
const DEFAULT_BLOCKING_CHECKS = [
  'Test Backend',
  'Lint Code',
  'Check Frontend',
  'Test SQLite Compatible Suite',
  'Check Rust Code',
  'Lint Markdown files',
  // The ratchet was decorative until 2026-08-30: nine files crossed the hard
  // limit on develop while PRs merged past a red file-size check.
  'Enforce per-file line limits (with ratchet baseline)',
  'Lint GitHub Actions workflows',
  'Secret scanning',
  // Build gates: never auto-merge code that doesn't build. (macOS/Windows build
  // matrices are intentionally NOT blocking — they are slower/flakier; the Linux
  // build + Quick Build Check are the representative gate. Override via
  // RAPITAS_AUTOMERGE_CHECKS if your matrix differs.)
  'Quick Build Check',
  'Build (ubuntu-latest)',
];

/** Resolve the set of check names that gate auto-merge. / マージをゲートするチェック名 */
export function blockingChecks(): Set<string> {
  const raw = process.env.RAPITAS_AUTOMERGE_CHECKS;
  const names = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_BLOCKING_CHECKS;
  return new Set(names);
}

/** Resolve the platform-specific `gh` CLI invocation path. / gh CLI のパス */
export function ghPath(): string {
  return process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';
}

export type CheckState = 'pass' | 'fail' | 'pending' | 'unknown';

/** One CI check as returned by `gh pr checks --json name,bucket,link`. */
export interface PrCheck {
  name: string;
  bucket: string;
  /** Details URL (e.g. .../actions/runs/<runId>/job/<jobId>) — used to fetch failed-job logs. */
  link?: string;
}

/**
 * Decide the aggregate state of the blocking checks. Pure — the testable core.
 *
 * @param checks - All checks reported for the PR. / PRの全チェック
 * @param blocking - Names that gate the merge. / マージをゲートするチェック名
 * @returns 'pass' when every present blocking check passed, 'fail' if any
 *   failed/cancelled, 'pending' if any is still running, 'unknown' if none of
 *   the blocking checks have reported yet. / 集約状態
 */
export function evaluateAutoMergeChecks(checks: PrCheck[], blocking: Set<string>): CheckState {
  const relevant = checks.filter((c) => blocking.has(c.name));
  if (relevant.length === 0) return 'unknown';
  if (relevant.some((c) => c.bucket === 'fail' || c.bucket === 'cancel')) return 'fail';
  if (relevant.some((c) => c.bucket === 'pending')) return 'pending';
  // Everything present is pass/skipping.
  return 'pass';
}

/**
 * Read the PR's checks via gh. Tolerates gh's non-zero exit on red/pending.
 *
 * @param cwd - Repo working directory / リポジトリ作業ディレクトリ
 * @param prNumber - PR number / PR番号
 * @returns Parsed checks, [] when the branch has no CI, null on transient error.
 */
export async function readPrChecks(cwd: string, prNumber: number): Promise<PrCheck[] | null> {
  try {
    const { stdout } = await execAsync(
      `${ghPath()} pr checks ${prNumber} --json name,bucket,link`,
      {
        cwd,
        encoding: 'utf8',
      },
    );
    return JSON.parse(stdout) as PrCheck[];
  } catch (err) {
    // gh exits non-zero when checks are failing/pending but still prints JSON.
    const stdout = (err as { stdout?: string }).stdout;
    if (stdout) {
      try {
        return JSON.parse(stdout) as PrCheck[];
      } catch {
        /* fall through */
      }
    }
    // A PR whose branch has no CI configured exits non-zero with this exact
    // stderr and empty stdout. That is NOT an error — treat it as "no checks
    // reported yet" (→ 'unknown' → the pending/timeout path) instead of logging a
    // WARN every 60s for every checkless PR (observed: #142/195/197-206 spamming).
    const stderr = (err as { stderr?: string }).stderr ?? '';
    if (/no checks reported/i.test(stderr)) {
      log.debug({ prNumber }, '[auto-merge] PR has no checks reported (no CI on branch)');
      return [];
    }
    log.warn({ err, prNumber }, '[auto-merge] Failed to read PR checks');
    return null;
  }
}

/**
 * Read GitHub's authoritative merge state (mergeStateStatus) for a PR. Used as a
 * fallback when no blocking CI checks are present: a branch with NO CI configured
 * would otherwise sit at 'unknown' forever and time out UNMERGED, even though
 * GitHub considers the PR CLEAN/mergeable. Returns null on a transient gh error.
 *
 * @param cwd - Repo working directory / リポジトリ作業ディレクトリ
 * @param prNumber - PR number / PR番号
 * @returns mergeStateStatus ('CLEAN' | 'BLOCKED' | 'BEHIND' | 'DIRTY' | 'UNKNOWN' …) or null
 */
export async function readMergeState(cwd: string, prNumber: number): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`${ghPath()} pr view ${prNumber} --json mergeStateStatus`, {
      cwd,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(stdout) as { mergeStateStatus?: string };
    return parsed.mergeStateStatus ?? null;
  } catch (err) {
    log.warn({ err, prNumber }, '[auto-merge] Failed to read PR merge state');
    return null;
  }
}

/**
 * Update the PR's head branch with the latest base via `gh pr update-branch`.
 * Used as the cheap first response to a CI failure on a BEHIND branch: pulling
 * in base often fixes drift-induced failures with zero implementation changes
 * (observed: task 537 / PR #339, green right after a manual update-branch).
 * Never throws — the caller only needs to know whether the call landed.
 *
 * @param cwd - Repo working directory / リポジトリ作業ディレクトリ
 * @param prNumber - PR number / PR番号
 * @returns true when gh accepted the update, false on any error. / 更新成否
 */
export async function updatePrBranch(cwd: string, prNumber: number): Promise<boolean> {
  try {
    await execAsync(`${ghPath()} pr update-branch ${prNumber}`, { cwd, encoding: 'utf8' });
    return true;
  } catch (err) {
    log.warn({ err, prNumber }, '[auto-merge] Failed to update PR branch');
    return false;
  }
}

/**
 * Read the PR's current head commit SHA. Used to detect "someone pushed a fix"
 * on a PR whose auto-merge retry budget was exhausted — a changed head is the
 * signal to resume watching it. Returns null on a transient gh error.
 *
 * @param cwd - Repo working directory / リポジトリ作業ディレクトリ
 * @param prNumber - PR number / PR番号
 * @returns Head commit SHA (headRefOid) or null. / head コミットSHA
 */
export async function readHeadSha(cwd: string, prNumber: number): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`${ghPath()} pr view ${prNumber} --json headRefOid`, {
      cwd,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(stdout) as { headRefOid?: string };
    return parsed.headRefOid ?? null;
  } catch (err) {
    log.warn({ err, prNumber }, '[auto-merge] Failed to read PR head SHA');
    return null;
  }
}
