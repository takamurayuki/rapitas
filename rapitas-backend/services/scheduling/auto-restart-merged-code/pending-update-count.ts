/**
 * pending-update-count
 *
 * Counts the updates merged into the primary branch that the running backend
 * has not activated yet, for 「更新の取り込み待ち N件」 on the progress strip.
 * Not responsible for fetching (the auto-restart scheduler fetches every tick)
 * or for deciding when to restart.
 */
import { runGitCommand } from '../../github/git-exec';

const CACHE_MS = 30_000;

/** Injectable dependencies; the defaults read the live scheduler and git. */
export interface PendingUpdateCounterDeps {
  startupCommit: () => string | null;
  run: (args: string[]) => Promise<string>;
  now: () => number;
  branch?: string;
}

/**
 * Build a counter that returns how many updates wait to be activated.
 * One update is one first-parent commit (a merge or a direct commit), so a PR
 * with many commits counts once.
 *
 * @param deps - Startup commit source, git runner and clock / 起動コミット・git・時計
 * @returns Async counter; null when it cannot tell / 件数を返す関数（不明なら null）
 */
export function createPendingUpdateCounter(
  deps: PendingUpdateCounterDeps,
): () => Promise<number | null> {
  let cached: { at: number; value: number | null } | null = null;
  return async () => {
    const now = deps.now();
    if (cached && now - cached.at < CACHE_MS) return cached.value;
    const start = deps.startupCommit();
    let value: number | null = null;
    if (start) {
      try {
        const branch = deps.branch ?? process.env.RAPITAS_PRIMARY_BRANCH ?? 'develop';
        const out = await deps.run([
          'rev-list',
          '--count',
          '--first-parent',
          `${start}..origin/${branch}`,
        ]);
        const n = Number.parseInt(out, 10);
        value = Number.isFinite(n) && n >= 0 ? n : null;
      } catch {
        value = null;
      }
    }
    cached = { at: now, value };
    return value;
  };
}

let liveCounter: (() => Promise<number | null>) | null = null;

/**
 * Pending update count for the live backend (cached 30 s).
 *
 * @returns Number of updates waiting, or null when unknown / 取り込み待ちの件数
 */
export async function getPendingUpdateCount(): Promise<number | null> {
  if (!liveCounter) {
    // Lazy import: the scheduler module is heavy and route tests do not load it.
    const { getAutoRestartMergedCodeScheduler } = await import('./index');
    liveCounter = createPendingUpdateCounter({
      startupCommit: () => getAutoRestartMergedCodeScheduler().getStartupCommit(),
      run: (args) => runGitCommand(args, undefined, { skipLog: true }),
      now: () => Date.now(),
    });
  }
  return liveCounter();
}
