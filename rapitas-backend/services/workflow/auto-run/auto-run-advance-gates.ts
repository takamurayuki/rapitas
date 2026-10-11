/**
 * auto-run-advance-gates
 *
 * The resource-contention, calendar-slot and merge-barrier holds that can defer next-task
 * selection for a running theme. Split out of auto-run-advance-select.ts
 * (task 784) to stay under the file-size ratchet; the caller checks each
 * gate in order and returns early on a hold. Not responsible for selecting a
 * task or building scope-overlap context — see auto-run-selection.ts /
 * auto-run-advance-scope.ts.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import { WorkflowQueueService } from '../workflow-queue';
import { logCycleEvent } from '../../observability';
import {
  getMergeBarrierMaxHoldMs,
  readMergeBarrierEnabled,
  shouldHoldForBarrier,
} from '../../scheduling/merge-barrier/merge-barrier';
import { notifyResourceContentionHold } from './auto-run-notifications';
import { getHostCpuBusyPercent } from '../../system/resource-telemetry';
import { evaluateResourceGate, consumeResourceGateOverride } from './resource-contention-gate';
import { evaluateCalendarGate, isSyncStale } from '../../scheduling/calendar-slot/free-slot';
import {
  clearCalendarHold,
  consumeCalendarGateOverride,
  getCalendarSlotSettings,
  getCalendarSnapshot,
  isCalendarHoldActive,
  markCalendarHold,
} from '../../scheduling/calendar-slot/calendar-hold-state';

const log = createLogger('theme-auto-run-scheduler');

/**
 * Resource-contention gate (task 725, default OFF): when a session has
 * intentionally raised concurrency above 1 AND the host CPU is busy, hold
 * next-task selection for one cycle instead of piling on more agents. A
 * pending manual override ("今すぐ実行") bypasses this check entirely for
 * exactly one cycle, so it is consumed before the gate is even evaluated.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme being advanced / 対象テーマ
 * @returns true when selection should be held this cycle. / 保留すべきなら true
 */
export async function checkResourceContentionGate(
  prisma: PrismaClient,
  themeId: number,
): Promise<boolean> {
  if (
    process.env.RAPITAS_RESOURCE_GATE_ENABLED !== 'true' ||
    consumeResourceGateOverride(themeId)
  ) {
    return false;
  }
  const thresholdPercent = Number(process.env.RAPITAS_RESOURCE_CPU_THRESHOLD_PERCENT || 85);
  const gate = evaluateResourceGate({
    enabled: true,
    effectiveMaxConcurrency: WorkflowQueueService.getInstance().getMaxConcurrency(),
    hostCpuBusyPercent: getHostCpuBusyPercent(),
    thresholdPercent,
    overridden: false,
  });
  if (!gate.hold || gate.cpuBusyPercent === null) return false;

  logCycleEvent('task.resource_hold', {
    theme: themeId,
    cause: 'host_cpu_busy',
    cpuBusyPercent: gate.cpuBusyPercent,
    thresholdPercent: gate.thresholdPercent,
    effectiveMaxConcurrency: gate.effectiveMaxConcurrency,
    msg: 'resource-contention gate — holding next-task selection for one cycle',
  });
  await prisma.activityLog
    .create({
      data: {
        taskId: null,
        action: 'auto_run.resource_deferred',
        metadata: JSON.stringify({
          themeId,
          cpuBusyPercent: gate.cpuBusyPercent,
          thresholdPercent: gate.thresholdPercent,
          effectiveMaxConcurrency: gate.effectiveMaxConcurrency,
        }),
      },
    })
    .catch((err) => {
      log.warn({ err, themeId }, '[ThemeAutoRunScheduler] Failed to record resource hold');
    });
  await notifyResourceContentionHold(themeId, gate.cpuBusyPercent, gate.thresholdPercent);
  return true;
}

/**
 * Calendar-slot gate (task 1174, default OFF): hold next-task selection from
 * `leadMinutes` before a Google Calendar busy block until it ends, so new
 * work only starts in free time. This gate covers NEW tasks only; a task that
 * is already running is stopped at its next phase boundary (the checkpoint)
 * by workflow-orchestrator-calendar-guard.ts — the running phase itself is
 * never interrupted. At the meeting end both holds lift and work resumes from
 * the saved workflowStatus. Fails open when the
 * last sync errored or is stale. Only hold start/release transitions are
 * logged (ActivityLog + cycle log) so a long meeting writes two rows, not one
 * per tick.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme being advanced / 対象テーマ
 * @param now - Current time (injected for tests) / 現在時刻
 * @returns true when selection should be held this cycle. / 保留すべきなら true
 */
export async function checkCalendarSlotGate(
  prisma: PrismaClient,
  themeId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const settings = getCalendarSlotSettings();
  if (!settings.enabled) return false;
  const snapshot = getCalendarSnapshot();
  const usable =
    snapshot.lastStatus === 'ok' && !isSyncStale(snapshot.lastSyncedAt, now, settings.pollMinutes);
  const gate = evaluateCalendarGate({
    now,
    busyBlocks: snapshot.busyBlocks,
    leadMinutes: settings.leadMinutes,
    enabled: usable,
    overridden: usable && consumeCalendarGateOverride(themeId),
  });
  if (!gate.hold) {
    if (clearCalendarHold(themeId)) {
      const cause = usable ? gate.reason : 'calendar_unavailable';
      logCycleEvent('task.calendar_hold_released', {
        theme: themeId,
        cause,
        msg: 'calendar-slot gate — hold released, selection resumes from the saved phase',
      });
      await recordCalendarActivity(prisma, 'calendar_slot.hold_released', { themeId, cause });
    }
    return false;
  }
  const wasHeld = isCalendarHoldActive(themeId, now);
  markCalendarHold(themeId, gate.releaseAt);
  if (!wasHeld) {
    logCycleEvent('task.calendar_hold', {
      theme: themeId,
      cause: gate.reason,
      releaseAt: gate.releaseAt?.toISOString() ?? null,
      msg: 'calendar-slot gate — holding next-task selection until the meeting ends',
    });
    await recordCalendarActivity(prisma, 'calendar_slot.hold_started', {
      themeId,
      reason: gate.reason,
      meetingStartAt: gate.blockStartAt?.toISOString() ?? null,
      releaseAt: gate.releaseAt?.toISOString() ?? null,
    });
  }
  return true;
}

async function recordCalendarActivity(
  prisma: PrismaClient,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await prisma.activityLog
    .create({ data: { taskId: null, action, metadata: JSON.stringify(metadata) } })
    .catch((err) => {
      log.warn({ err, action }, '[ThemeAutoRunScheduler] Failed to record calendar-slot event');
    });
}

/**
 * Merge barrier (task 573 C, default OFF): while the theme still has an OPEN
 * auto-created PR, hold next-task selection until it merges/closes — or
 * until the hold ceiling passes (deadlock release for a PR stuck open on red
 * CI / manual review). `barrierHoldSince` is mutated in place (cleared when
 * released or the barrier is off).
 *
 * @param themeId - Theme being advanced / 対象テーマ
 * @param openAutoPrs - The theme's open auto-created PRs. / オープン自動PR一覧
 * @param barrierHoldSince - Per-theme merge-barrier hold start (epoch ms), owned by the scheduler / マージバリア保留開始時刻
 * @returns true when selection should be held this cycle. / 保留すべきなら true
 */
export function checkMergeBarrierGate(
  themeId: number,
  openAutoPrs: Array<{ prNumber: number }>,
  barrierHoldSince: Map<number, number>,
): boolean {
  if (!readMergeBarrierEnabled()) {
    barrierHoldSince.delete(themeId);
    return false;
  }
  const holdSince = barrierHoldSince.get(themeId) ?? null;
  if (
    !shouldHoldForBarrier(
      true,
      openAutoPrs.length > 0,
      holdSince,
      Date.now(),
      getMergeBarrierMaxHoldMs(),
    )
  ) {
    // Released: PR set went empty (merged/closed) or the hold timed out.
    barrierHoldSince.delete(themeId);
    return false;
  }
  if (holdSince === null) barrierHoldSince.set(themeId, Date.now());
  logCycleEvent('task.barrier_hold', {
    theme: themeId,
    cause: 'open_pr_wait',
    prNumbers: openAutoPrs.map((p) => p.prNumber),
    holdMs: holdSince === null ? 0 : Date.now() - holdSince,
    msg: 'merge barrier — holding next-task selection until the open auto-PR merges',
  });
  return true;
}
