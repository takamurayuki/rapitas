/**
 * ResourceTelemetry
 *
 * Lightweight host-wide CPU usage sampler for the resource-contention gate
 * (task 725). Uses only `os.cpus()` tick deltas — no PowerShell/CIM process
 * enumeration, which was measured elsewhere (dev.js RSS watchdog) to cost far
 * more CPU than the git calls it was meant to protect. `os.loadavg()` is not
 * used because it always returns `[0, 0, 0]` on Windows.
 * Not responsible for deciding whether to hold auto-run selection — see
 * services/workflow/auto-run/resource-contention-gate.ts.
 */
import { cpus } from 'os';
import { createLogger } from '../../config/logger';

const log = createLogger('resource-telemetry');

const DEFAULT_SAMPLE_INTERVAL_MS = 30_000;

interface CpuTickTotals {
  idle: number;
  total: number;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastTotals: CpuTickTotals | null = null;
let cachedBusyPercent: number | null = null;

/** Sums idle/total ticks across all cores from `os.cpus()`. */
function readCpuTotals(): CpuTickTotals {
  const cores = cpus();
  let idle = 0;
  let total = 0;
  for (const core of cores) {
    idle += core.times.idle;
    total += core.times.user + core.times.nice + core.times.sys + core.times.idle + core.times.irq;
  }
  return { idle, total };
}

/**
 * Computes the busy percentage between two cumulative tick snapshots.
 *
 * @param previous - Earlier cumulative idle/total ticks / 前回の累積tick
 * @param current - Later cumulative idle/total ticks / 今回の累積tick
 * @returns Busy percentage in [0, 100], or `null` if the interval had no tick movement / 稼働率(%)
 */
export function computeBusyPercent(previous: CpuTickTotals, current: CpuTickTotals): number | null {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) return null;
  const busy = ((totalDelta - idleDelta) / totalDelta) * 100;
  return Math.max(0, Math.min(100, busy));
}

function sampleOnce(): void {
  try {
    const current = readCpuTotals();
    if (lastTotals) {
      const busy = computeBusyPercent(lastTotals, current);
      if (busy !== null) cachedBusyPercent = busy;
    }
    lastTotals = current;
  } catch (err) {
    log.warn({ err }, 'Failed to sample host CPU usage');
  }
}

/**
 * Starts the interval sampler when `RAPITAS_RESOURCE_GATE_ENABLED=true`;
 * otherwise a no-op (default behavior is unchanged).
 *
 * @param intervalMs - Sampling interval override, mainly for tests / サンプリング間隔（テスト用）
 */
export function startResourceTelemetryIfEnabled(
  intervalMs: number = Number(
    process.env.RAPITAS_RESOURCE_SAMPLE_INTERVAL_MS || DEFAULT_SAMPLE_INTERVAL_MS,
  ),
): void {
  if (process.env.RAPITAS_RESOURCE_GATE_ENABLED !== 'true') return;
  if (intervalHandle) return; // already running
  sampleOnce();
  intervalHandle = setInterval(sampleOnce, intervalMs);
  intervalHandle.unref?.();
}

/** Stops the sampler and clears the cache. Used by tests to avoid timer leaks. */
export function stopResourceTelemetry(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  lastTotals = null;
  cachedBusyPercent = null;
}

/**
 * Returns the most recent sampled host CPU busy percentage.
 *
 * @returns Busy percentage in [0, 100], or `null` before the first completed sample / 未サンプリング時はnull
 */
export function getHostCpuBusyPercent(): number | null {
  return cachedBusyPercent;
}
