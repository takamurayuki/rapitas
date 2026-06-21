/**
 * dev-restart-on-dry
 *
 * Optional dev-mode auto-restart. When a theme's auto-run runs out of work (the
 * quiet point with no live agents) AND the local checkout has new commits since
 * this backend started, gracefully restart so committed fixes take effect before
 * more tasks are created. Gated behind UserSettings.restartOnAutoRunDry, a global
 * no-agent check, a "HEAD actually moved" check, and a rate limit.
 *
 * Only meaningful under the dev orchestrator (dev.js relaunches the process on
 * exit code 75). Not responsible for selecting/creating tasks.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { AgentOrchestrator } from '../../agents/agent-orchestrator';

const execFileAsync = promisify(execFile);
const log = createLogger('auto-run:dev-restart');

/** dev.js relaunches the backend when it exits with this code. */
const RESTART_EXIT_CODE = 75;
/** Never auto-restart more often than this (avoid restart loops). */
const MIN_RESTART_INTERVAL_MS = 10 * 60 * 1000;
/**
 * Hard ceiling on graceful shutdown before we exit anyway. A restart must NEVER
 * leave the backend wedged (not serving, not relaunching) just because shutdown
 * hung — exit(75) so dev.js relaunches regardless.
 */
const SHUTDOWN_BUDGET_MS = 30_000;

let startupCommit: string | null = null;
let lastRestartAt = 0;
let restarting = false;
let lastDiagAt = 0;

/**
 * Throttled diagnostic: records WHICH gate turned a self-deploy attempt into a
 * no-op. maybeRestartForUpdate now fires on every task boundary, so this would
 * spam — emit at most once per minute. Exists to settle "why did self-deploy
 * never fire during continuous auto-run?"; safe to remove once confirmed.
 */
function diag(gate: string, detail?: Record<string, unknown>): void {
  const now = Date.now();
  if (now - lastDiagAt < 60_000) return;
  lastDiagAt = now;
  log.info({ gate, ...detail }, `[dev-restart] no-op at gate: ${gate}`);
}

/** Current HEAD of the backend's checkout, or null if git is unavailable. */
async function headCommit(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Capture the commit the backend booted on. Call once at scheduler start so a
 * later dry-restart only fires when HEAD has actually advanced past it.
 */
export async function recordStartupCommit(): Promise<void> {
  if (startupCommit) return;
  startupCommit = await headCommit();
  log.info({ startupCommit }, '[dev-restart] recorded startup commit');
}

/** Whether the toggle is on. Read via cast — the column is pending client regen. */
async function restartEnabled(): Promise<boolean> {
  const s = (await prisma.userSettings.findFirst().catch(() => null)) as {
    restartOnAutoRunDry?: boolean | null;
  } | null;
  return s?.restartOnAutoRunDry === true;
}

/**
 * Gracefully restart when all gates pass: enabled + new commits since boot + no
 * live agents anywhere + not rate-limited. Returns true when a restart was kicked
 * off (so the caller skips backlog promotion / idling this pass).
 *
 * @param themeId - The theme whose auto-run just ran dry. / 枯渇したテーマID
 * @returns Whether a restart was initiated. / 再起動を開始したか
 */
export async function maybeRestartForUpdate(themeId: number): Promise<boolean> {
  if (restarting) return true;

  // Only self-restart under the desktop dev orchestrator (dev.js sets TAURI_BUILD
  // and relaunches on exit 75). In web dev / a direct run nothing watches for exit
  // 75, so exiting would ORPHAN the backend and kill the loop — make it a no-op.
  if (process.env.TAURI_BUILD !== 'true') {
    diag('TAURI_BUILD!=true', { tauriBuild: process.env.TAURI_BUILD ?? '(unset)' });
    return false;
  }

  // Cheapest check first (in-memory): require global quiescence so we never kill
  // an in-flight agent. This is safe to call on EVERY tick — a busy loop with a
  // large backlog rarely reaches all_done, but it does briefly hit 0 agents
  // BETWEEN tasks; catching that gap is what lets fixes apply without waiting for
  // the whole backlog to drain.
  const active = AgentOrchestrator.getInstance(prisma).getActiveExecutionCount();
  if (active > 0) {
    diag('active>0', { active });
    return false;
  }

  if (!(await restartEnabled())) {
    diag('restartOnAutoRunDry=off');
    return false;
  }

  // Respect a user STOP. dev-restart exists only to let the AUTO-RUN loop pick up
  // committed fixes between tasks — it is driven from the scheduler tick, which
  // keeps polling even after every theme is stopped (a user stop sets
  // enabled:false via finalizeStop but does NOT stop the global poller). Without
  // this gate the backend self-reboots on the next commit even though auto-run is
  // off — the observed "stopped auto-run yet it restarted" surprise. Only restart
  // while at least one theme is armed/active (enabled:true).
  const activeAutoRun = await prisma.themeAutoRun
    .count({ where: { enabled: true } })
    .catch(() => 0);
  if (activeAutoRun === 0) {
    diag('no-armed-theme');
    return false;
  }

  const now = Date.now();
  if (lastRestartAt && now - lastRestartAt < MIN_RESTART_INTERVAL_MS) {
    diag('rate-limited', { msSinceLast: now - lastRestartAt });
    return false;
  }

  // Only restart when there is genuinely something new to apply.
  const current = await headCommit();
  if (!current || !startupCommit || current === startupCommit) {
    diag('HEAD-unchanged', { startupCommit, current });
    return false;
  }

  restarting = true;
  lastRestartAt = now;
  log.warn(
    { themeId, startupCommit, current },
    '[dev-restart] auto-run dry + new commits + no agents — restarting to apply updates',
  );
  void gracefulRestart();
  return true;
}

/** Graceful shutdown then exit with the restart code dev.js watches for. */
async function gracefulRestart(): Promise<void> {
  // Backstop: if gracefulShutdown hangs, exit anyway so the restart can't wedge
  // the backend (neither serving nor relaunching). Resolved path clears this.
  const hardExit = setTimeout(() => {
    log.warn('[dev-restart] shutdown exceeded budget — forcing exit to relaunch');
    process.exit(RESTART_EXIT_CODE);
  }, SHUTDOWN_BUDGET_MS);
  try {
    await AgentOrchestrator.getInstance(prisma).gracefulShutdown();
  } catch (err) {
    log.error({ err }, '[dev-restart] graceful shutdown error; exiting anyway');
  }
  clearTimeout(hardExit);
  // Small delay so logs flush + the shutdown settles before the process dies.
  setTimeout(() => process.exit(RESTART_EXIT_CODE), 300);
}
