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
  /**
   * Generated files restored to let the sync proceed. Empty on every path
   * that did not have to touch the tree. / 復元した生成物
   */
  restoredGenerated?: string[];
  /** Paths that made the tree dirty, when that is why it stopped. / dirty の内訳 */
  dirtyPaths?: string[];
}

/**
 * Files the dev server rewrites by itself, so a dirty entry for one of them
 * says nothing about human work in progress.
 *
 * `rapitas-frontend`'s `predev` runs `generate-messages.mjs` on every start,
 * which rewrites these two from `messages/fragments/`. Whenever that output
 * differs from what was committed, the primary checkout is dirty from the
 * moment the dev server boots — and the dirty check below then refuses to
 * sync, for ever. Measured 2026-10-18: the primary sat on the commit it
 * booted with while six merges landed, held back solely by these two files
 * carrying content that was already committed upstream (#1060).
 *
 * Restoring them loses nothing: they are reproducible from the fragments,
 * which are themselves committed.
 */
export const REGENERABLE_PATHS = [
  'rapitas-frontend/messages/ja.json',
  'rapitas-frontend/messages/en.json',
];

/**
 * The paths in a `git status --porcelain` listing.
 *
 * Porcelain v1 puts two status characters and a space before the path, and
 * quotes paths needing escapes. A rename reads `old -> new`; the new name is
 * the one on disk.
 *
 * @param status - Raw porcelain output / porcelain の生出力
 * @returns One path per changed entry / 変更エントリのパス
 */
export function parseDirtyPaths(status: string): string[] {
  return status
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 3)
    .map((line) => {
      const path = line.slice(3);
      const renamed = path.split(' -> ');
      return (renamed[renamed.length - 1] ?? path).replace(/^"|"$/g, '');
    });
}

/** Whether every dirty path is a file the dev server regenerates. */
export function onlyRegenerable(paths: string[]): boolean {
  return paths.length > 0 && paths.every((p) => REGENERABLE_PATHS.includes(p));
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
  const restoredGenerated: string[] = [];
  const dirtyPaths = parseDirtyPaths(status);
  if (dirtyPaths.length > 0) {
    // Only generated files? Restore them and carry on. Anything else is
    // someone's work in progress and is still left strictly alone.
    if (!onlyRegenerable(dirtyPaths)) {
      log.warn({ dirtyPaths, branch }, '[fast-forward] checkout is dirty; leaving it alone');
      return { moved: false, reason: 'dirty', branch, dirtyPaths };
    }
    try {
      await run(['checkout', '--', ...dirtyPaths]);
      restoredGenerated.push(...dirtyPaths);
      log.info(
        { restoredGenerated, branch },
        '[fast-forward] restored regenerated files so the sync can proceed',
      );
    } catch (err) {
      log.warn({ err, dirtyPaths }, '[fast-forward] could not restore generated files');
      return { moved: false, reason: 'dirty', branch, dirtyPaths };
    }
  }

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
  if (!head || !remote || head === remote)
    return { moved: false, reason: 'up-to-date', branch, restoredGenerated };

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
  return { moved: true, reason: 'fast-forwarded', branch, restoredGenerated };
}
