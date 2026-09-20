/**
 * auto-merge-premerge-gate
 *
 * Last line of defence before an auto-merge: requires the required workflows to
 * have finished on the head SHA and runs the file-size ratchet locally against
 * the PR's merge ref inside a throwaway detached worktree. NOT responsible for
 * merging or for recovering from a violation (the watcher routes that).
 *
 * The primary checkout is never touched (no checkout/stash) — only a temp
 * worktree that is always removed in `finally`.
 */
import { exec } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createLogger } from '../../config/logger';
import { checkRequiredWorkflows } from './auto-merge-required-workflows';

const execAsync = promisify(exec);
const log = createLogger('workflow:auto-merge-premerge-gate');

/** Blocking-check name used when routing a ratchet violation to CI repair. */
export const RATCHET_CHECK_NAME = 'Enforce per-file line limits (with ratchet baseline)';

const RATCHET_SCRIPT = path.join('scripts', 'check-large-files.cjs');
const EXEC_TIMEOUT_MS = 120_000;

export type RatchetVerdict =
  | { verdict: 'pass' | 'skipped' }
  | { verdict: 'violation'; detail: string }
  | { verdict: 'error'; detail: string };

/** Injectable side effects for tests. */
export interface RatchetDeps {
  run: (command: string, cwd: string) => Promise<{ stdout: string }>;
  exists: (p: string) => boolean;
  removeDir: (p: string) => void;
}

const defaultRatchetDeps: RatchetDeps = {
  run: async (command, cwd) => {
    try {
      return await execAsync(command, { cwd, encoding: 'utf8', timeout: EXEC_TIMEOUT_MS });
    } catch (err) {
      // The ratchet script exits 1 on violation but still prints its JSON.
      const e = err as { stdout?: string };
      if (typeof e.stdout === 'string' && e.stdout.trim().startsWith('{')) {
        return { stdout: e.stdout };
      }
      throw err;
    }
  },
  exists: existsSync,
  removeDir: (p) => rmSync(p, { recursive: true, force: true }),
};

interface RatchetJson {
  baseline_grew?: Array<{ file: string; lines: number; baseline: number }>;
  baseline_new?: Array<{ file: string; lines: number }>;
}

/**
 * Run `check-large-files.cjs --json` on a remote ref inside a detached temp worktree.
 *
 * @param cwd - Repo working directory / リポジトリ作業ディレクトリ
 * @param refspec - Ref fetched from origin (e.g. `pull/12/merge` or `develop`). / 取得する ref
 * @param tag - Label for the temp directory name. / 一時ディレクトリ名のラベル
 * @param deps - Injectable side effects (tests). / 依存注入
 * @returns pass/skipped, violation (ratchet grew/new), or error (fail closed). / 判定
 */
export async function runRatchetAtRef(
  cwd: string,
  refspec: string,
  tag: string,
  deps: RatchetDeps = defaultRatchetDeps,
): Promise<RatchetVerdict> {
  // Repos without the ratchet script (other projects) are out of scope.
  if (!deps.exists(path.join(cwd, RATCHET_SCRIPT))) return { verdict: 'skipped' };

  const dir = path.join(tmpdir(), `rapitas-ratchet-${tag}-${process.pid}`);
  let created = false;
  try {
    await deps.run(`git fetch origin ${refspec}`, cwd);
    await deps.run(`git worktree add --detach "${dir}" FETCH_HEAD`, cwd);
    created = true;
    const { stdout } = await deps.run(`node ${RATCHET_SCRIPT} --json`, dir);
    const parsed = JSON.parse(stdout) as RatchetJson;
    const grew = parsed.baseline_grew ?? [];
    const added = parsed.baseline_new ?? [];
    if (grew.length === 0 && added.length === 0) return { verdict: 'pass' };
    const detail = [
      ...grew.map((g) => `${g.file}: ${g.lines} > baseline ${g.baseline}`),
      ...added.map((n) => `${n.file}: ${n.lines} (new, over hard limit)`),
    ].join('; ');
    return { verdict: 'violation', detail };
  } catch (err) {
    log.warn({ err, refspec }, '[auto-merge] Ratchet check could not complete');
    return { verdict: 'error', detail: err instanceof Error ? err.message : String(err) };
  } finally {
    if (created) {
      await deps.run(`git worktree remove --force "${dir}"`, cwd).catch(() => {});
    }
    // Belt and braces: a failed `worktree remove` must not leave the dir behind.
    try {
      deps.removeDir(dir);
      await deps.run('git worktree prune', cwd).catch(() => {});
    } catch {
      /* best effort */
    }
  }
}

export type PreMergeGateResult =
  | { ok: true }
  | { ok: false; reason: 'workflows_pending' | 'ratchet_violation' | 'gate_error'; detail: string };

/**
 * Decide whether a CI-green PR may proceed to completion/merge.
 *
 * @param cwd - Repo working directory / リポジトリ作業ディレクトリ
 * @param prNumber - PR number / PR番号
 * @param opts - localRatchet: also run the ratchet on the merge ref (merge mode). / オプション
 * @returns ok, or the reason it must wait / be repaired. / 判定
 */
export async function evaluatePreMergeGate(
  cwd: string,
  prNumber: number,
  opts: { localRatchet: boolean },
): Promise<PreMergeGateResult> {
  const wf = await checkRequiredWorkflows(cwd, prNumber);
  if (!wf.complete) {
    return { ok: false, reason: 'workflows_pending', detail: wf.waiting.join(', ') };
  }
  if (!opts.localRatchet) return { ok: true };

  const r = await runRatchetAtRef(cwd, `pull/${prNumber}/merge`, `pr${prNumber}`);
  if (r.verdict === 'violation')
    return { ok: false, reason: 'ratchet_violation', detail: r.detail };
  if (r.verdict === 'error') return { ok: false, reason: 'gate_error', detail: r.detail };
  return { ok: true };
}
