/**
 * StartupWarmup
 *
 * The post-listen warm-up sequence: schedulers, the memory system, recovery
 * scans and the agent worker, each run after the listener is already open.
 * Extracted from index.ts so the composition root stays under the file-size
 * ratchet, matching the precedent set by top-level-health-route.ts.
 */
import { createLogger } from '../../config/logger';
import { isApiRecoveryMode } from './api-recovery-mode';
import { markWarmupComplete, markWarmupStage } from './startup-readiness';
import { workerManager } from '../core/orchestrator-instance';
import { AIOrchestra } from '../workflow/ai-orchestra';
import { AutoMergeWatcher } from '../workflow/auto-merge-watcher';
import { migrateLegacyWorkflowFiles } from '../workflow/workflow-legacy-migrator';
import { startWorkflowReconciler } from '../workflow/workflow-reconciler';
import { BehaviorScheduler } from '../../src/services/behavior-scheduler';
import { initializeMemorySystem } from '../memory';
import { startSupervisionHeartbeatScheduler } from '../supervision';
import { startWorkerHealthAlertScheduler } from '../agents/worker-health/worker-health-alert-service';
import { startAutoRestartMergedCodeScheduler } from '../scheduling/auto-restart-merged-code';
import { startBacklogScheduler } from '../scheduling/backlog-scheduler';
import { startDecisionTraceConsistencyScheduler } from '../scheduling/decision-trace-consistency-scheduler';
import { startI18nIntegrityScheduler } from '../scheduling/i18n-integrity-scheduler';
import { startWorktreeCleanupScheduler } from '../scheduling/worktree-cleanup-scheduler';
import { runStartupBackfills } from './startup-backfills';
import { startBackupScheduler } from './backup-scheduler';
import { startCpuUsageMonitorIfEnabled } from './cpu-usage-monitor';
import { startEventLoopLagWatchdog } from './event-loop-lag-watchdog';
import { startResourceTelemetryIfEnabled } from './resource-telemetry';

const log = createLogger('server');

/**
 * Heavy warm-up, AFTER the listener opens and yielding between tasks, so the
 * single JS thread answers during boot (fixes "page open across a restart hits
 * the 30s timeout"). Each task is timed (`warmupMs`) and reported to
 * startup-readiness, so /health separates listening from ready (#1323).
 */
const runStartupWarmup = async (): Promise<void> => {
  const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  const timed = async (label: string, fn: () => unknown | Promise<unknown>): Promise<void> => {
    markWarmupStage(label);
    const startedAt = Date.now();
    try {
      await fn();
      log.info({ warmupMs: Date.now() - startedAt }, `Warm-up: ${label} ready`);
    } catch (err) {
      log.error({ err, warmupMs: Date.now() - startedAt }, `Warm-up: ${label} failed`);
    }
  };

  // Brief grace so the listener can answer the first in-flight requests
  // before we start CPU-heavy init on the single JS thread.
  await new Promise((resolve) => setTimeout(resolve, 250));

  const runWarmupTasks = async (tasks: Array<[string, () => unknown | Promise<unknown>]>) => {
    for (const [label, fn] of tasks) {
      await timed(label, fn);
      await yieldToLoop();
    }
  };
  const recoverRuntimeServerRegistryTask = async () => {
    const { recoverRuntimeServerRegistry } =
      await import('../agents/verification/runtime-smoke/worktree-server-registry');
    await recoverRuntimeServerRegistry();
  };
  await runWarmupTasks([
    ['runtime-server-registry-reconcile', recoverRuntimeServerRegistryTask],
    ['behavior-scheduler', () => BehaviorScheduler.start()],
    ['memory-system', () => initializeMemorySystem()],
    ['ai-orchestra-recovery', () => AIOrchestra.getInstance().recoverOnStartup()],
    ['legacy-workflow-migration', () => migrateLegacyWorkflowFiles()],
    ['startup-backfills', () => runStartupBackfills()],
    ['agent-worker-manager', () => workerManager.initialize()],
  ]);
  await timed('backlog-scheduler', () => startBacklogScheduler());
  startEventLoopLagWatchdog();
  // NOTE(task 966): these previously had no yieldToLoop(), causing restart-adjacent stalls.
  await runWarmupTasks([
    ['backup-scheduler', () => startBackupScheduler()],
    ['worktree-cleanup-scheduler', () => startWorktreeCleanupScheduler()],
    ['decision-trace-consistency-scheduler', () => startDecisionTraceConsistencyScheduler()],
    ['auto-restart-merged-code-scheduler', () => startAutoRestartMergedCodeScheduler()],
    ['worker-health-alert-scheduler', () => startWorkerHealthAlertScheduler()],
    ['auto-merge-watcher', () => AutoMergeWatcher.getInstance().start()],
    ['workflow-reconciler', () => startWorkflowReconciler()],
    ['resource-telemetry', () => startResourceTelemetryIfEnabled()],
    ['cpu-usage-monitor', () => startCpuUsageMonitorIfEnabled()],
    ['supervision-heartbeat-scheduler', () => startSupervisionHeartbeatScheduler()],
    ['i18n-integrity-scheduler', () => startI18nIntegrityScheduler()],
  ]);
  markWarmupComplete();
  log.info('Startup warm-up complete');
};

/**
 * Start warm-up unless this process is in recovery mode.
 *
 * Fire-and-forget: never blocks the listener. Recovery mode runs no warm-up,
 * so there is no window to wait out and it is ready as soon as it listens.
 */
export function startWarmupUnlessRecovering(): void {
  if (isApiRecoveryMode()) markWarmupComplete();
  else void runStartupWarmup();
}
