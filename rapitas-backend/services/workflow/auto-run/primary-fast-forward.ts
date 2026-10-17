/**
 * primary-fast-forward
 *
 * Brings the primary checkout the dev backend runs from up to its remote
 * branch, so the self-restart has something to apply.
 * Not responsible for deciding WHETHER to restart — dev-restart-on-dry owns
 * every gate; this only moves HEAD, and only when that is safe.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../config/logger';

const execFileAsync = promisify(execFile);
const log = createLogger('auto-run:primary-fast-forward');

/** Runs one git command in the checkout and returns stdout. */
export type GitRun = (args: string[]) => Promise<string>;

/** Why the fast-forward did or did not move HEAD. */
export type FastForwardReason =
  | 'fast-forwarded'
  | 'up-to-date'
  | 'dirty'
  | 'diverged'
  | 'fetch-failed'
  | 'merge-failed'
  | 'status-failed'
  | 'rev-parse-failed';

/** Outcome of one attempt. */
export interface FastForwardResult {
  /** Whether HEAD actually advanced. */
  moved: boolean;
  reason: FastForwardReason;
  /** The branch that was targeted. */
  branch: string;
}

/** The branch dev.js pins the primary checkout to. */
function targetBranch(): string {
  return process.env.RAPITAS_PRIMARY_BRANCH?.trim() || 'develop';
}

/** Whatever a runner resolved with, as a string. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const defaultRun: GitRun = async (args) => {
  const { stdout } = await execFileAsync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return stdout;
};

/**
 * Fast-forward the primary checkout to `origin/<branch>`.
 *
 * Never forces and never resets. A DIRTY tree is left alone because the
 * self-development system edits this checkout concurrently, so uncommitted
 * work there is normal; a DIVERGED one is left alone because diverging the
 * primary makes every task branch look tampered with and turns every sync
 * into a conflict. Both are reported rather than repaired.
 *
 * @param deps - Injected git runner (tests) / テスト用の git 実行関数
 * @returns Whether HEAD moved, and why / HEAD が進んだかと理由
 */
export async function fastForwardPrimary(deps: { run?: GitRun } = {}): Promise<FastForwardResult> {
  const run = deps.run ?? defaultRun;
  const branch = targetBranch();

  // Every result is coerced before use. This runs inside the scheduler tick,
  // so a runner that resolves with an unexpected shape must produce a reason,
  // never a thrown TypeError that takes the tick down with it.
  let status: string;
  try {
    status = text(await run(['status', '--porcelain']));
  } catch (err) {
    log.warn({ err }, '[fast-forward] status failed; leaving the checkout alone');
    return { moved: false, reason: 'status-failed', branch };
  }
  if (status.trim().length > 0) return { moved: false, reason: 'dirty', branch };

  try {
    await run(['fetch', 'origin', branch]);
  } catch (err) {
    // The network is not the checkout's problem; try again next quiet point.
    log.warn({ err, branch }, '[fast-forward] fetch failed');
    return { moved: false, reason: 'fetch-failed', branch };
  }

  let head: string;
  let remote: string;
  try {
    head = text(await run(['rev-parse', 'HEAD'])).trim();
    remote = text(await run(['rev-parse', `origin/${branch}`])).trim();
  } catch (err) {
    log.warn({ err, branch }, '[fast-forward] rev-parse failed');
    return { moved: false, reason: 'rev-parse-failed', branch };
  }
  if (!head || !remote || head === remote) return { moved: false, reason: 'up-to-date', branch };

  // `--is-ancestor` exits non-zero when HEAD is NOT reachable from the remote,
  // which is exactly the diverged case a fast-forward must refuse.
  try {
    await run(['merge-base', '--is-ancestor', head, remote]);
  } catch {
    log.warn({ branch, head, remote }, '[fast-forward] checkout has diverged; not touching it');
    return { moved: false, reason: 'diverged', branch };
  }

  try {
    await run(['merge', '--ff-only', `origin/${branch}`]);
  } catch (err) {
    log.warn({ err, branch }, '[fast-forward] ff-only merge failed');
    return { moved: false, reason: 'merge-failed', branch };
  }

  log.info({ branch, from: head.slice(0, 12), to: remote.slice(0, 12) }, '[fast-forward] advanced');
  return { moved: true, reason: 'fast-forwarded', branch };
}
