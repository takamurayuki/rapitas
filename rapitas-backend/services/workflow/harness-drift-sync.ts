/**
 * harness-drift-sync
 *
 * Brings the runtime-verification harness into a task branch that predates
 * it, BEFORE the automated verification gate runs, so the runtime check can
 * actually execute instead of holding as UNVERIFIED forever. Reuses the
 * pre-PR base sync (fetch + merge origin/<base>, in-context conflict
 * resolution, lint/typecheck re-verification). Not responsible for deciding
 * pass/fail — a failed or skipped sync simply leaves the gate to report the
 * runtime check as unverified and completion withheld (PR #670 semantics).
 */
import { createLogger } from '../../config/logger';
import { runGitCommand } from '../github/git-exec';
import { syncBaseIntoBranch, type BaseSyncResult } from './pre-pr-base-sync';
import {
  resolveRuntimeConfig,
  resolveThemeWorkingDirectory,
} from '../agents/verification/runtime-smoke/runtime-config';
import {
  detectRuntimeHarnessDrift,
  hasRuntimeStartScript,
} from '../agents/verification/runtime-smoke/runtime-start-preflight';

const log = createLogger('workflow:harness-drift-sync');

/** Injectable collaborators (tests). */
export interface HarnessDriftSyncDeps {
  resolveConfig: typeof resolveRuntimeConfig;
  themeDir: typeof resolveThemeWorkingDirectory;
  detectDrift: typeof detectRuntimeHarnessDrift;
  hasScript: typeof hasRuntimeStartScript;
  runGit: (args: string[], cwd: string) => Promise<string>;
  sync: typeof syncBaseIntoBranch;
}

const defaultDeps = (): HarnessDriftSyncDeps => ({
  resolveConfig: resolveRuntimeConfig,
  themeDir: resolveThemeWorkingDirectory,
  detectDrift: detectRuntimeHarnessDrift,
  hasScript: hasRuntimeStartScript,
  runGit: (args, cwd) => runGitCommand(args, cwd, { skipLog: true }),
  sync: syncBaseIntoBranch,
});

/** Outcome of one pre-gate harness sync attempt. */
export interface HarnessDriftSyncResult {
  /** The drift reason that triggered the sync. */
  reason: string;
  /** Base-sync outcome, or 'not_attempted' when the worktree was dirty. */
  sync: BaseSyncResult | { status: 'not_attempted'; detail: string };
  /** True when the start script is present after the sync. */
  harnessPresent: boolean;
}

/**
 * Sync origin/<base> into the task worktree when (and only when) the runtime
 * harness is missing there but present in the theme's main checkout.
 *
 * @param p - Task id, worktree, base branch, optional session id and dep overrides / 入力一式
 * @returns The sync outcome, or null when no drift was detected / 同期結果
 */
export async function syncHarnessIfDrifted(p: {
  taskId: number;
  gitCwd: string;
  baseBranch: string;
  sessionId?: number;
  deps?: Partial<HarnessDriftSyncDeps>;
}): Promise<HarnessDriftSyncResult | null> {
  const deps = { ...defaultDeps(), ...p.deps };
  const loaded = await deps.resolveConfig({ workdir: p.gitCwd, taskId: p.taskId });
  if (!loaded?.config) return null;
  const start = loaded.config.start;
  const reason = await deps.detectDrift(start, p.gitCwd, await deps.themeDir(p.taskId));
  if (!reason) return null;

  // The merge must land on a committed tree; uncommitted agent edits would
  // either block the merge or be silently folded into it. Leave the gate to
  // hold in that case — the pipeline commits later and the next pass syncs.
  const porcelain = (await deps.runGit(['status', '--porcelain'], p.gitCwd).catch(() => '')).trim();
  if (porcelain.length > 0) {
    log.warn(
      { taskId: p.taskId, gitCwd: p.gitCwd },
      '[harness-sync] worktree has uncommitted changes — not syncing base before the gate',
    );
    return {
      reason,
      sync: { status: 'not_attempted', detail: 'uncommitted changes in worktree' },
      harnessPresent: false,
    };
  }

  log.info(
    { taskId: p.taskId, baseBranch: p.baseBranch, reason },
    '[harness-sync] runtime harness missing in worktree — syncing base before verification',
  );
  const sync = await deps.sync({
    gitCwd: p.gitCwd,
    baseBranch: p.baseBranch,
    taskId: p.taskId,
    sessionId: p.sessionId,
  });
  const harnessPresent = (await deps.hasScript(start, p.gitCwd)) === true;
  log.info(
    { taskId: p.taskId, status: sync.status, changedFiles: sync.changedFiles, harnessPresent },
    '[harness-sync] base sync finished',
  );
  return { reason, sync, harnessPresent };
}
