/**
 * CpuUsageMonitor
 *
 * Periodic self-CPU heartbeat for the backend's OWN Bun process, using
 * `process.cpuUsage()` deltas — not `resource-telemetry.ts`'s host-wide
 * `os.cpus()` sampler, which cannot tell whether high host CPU is THIS
 * process or something else (WebView2, an aux-CLI child, another app).
 * Logged to the cycle-event NDJSON stream (services/observability) so a
 * sustained-high-CPU investigation can line samples up against every other
 * cycle event (phase transitions, gh calls, scheduler ticks) by timestamp in
 * one file. Diagnostic tool, not a permanent cost: off by default
 * (RAPITAS_CPU_MONITOR_ENABLED=true to opt in).
 */
import { createLogger } from '../../config/logger';
import { logCycleEvent } from '../observability';

const log = createLogger('system:cpu-usage-monitor');

const DEFAULT_INTERVAL_MS = 5_000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastCpuUsage: NodeJS.CpuUsage | null = null;
let lastSampleAt = 0;

/**
 * Percent of one CPU core consumed between two `process.cpuUsage()`
 * snapshots (user+system microseconds / elapsed ms).
 *
 * @param previous - Earlier cumulative cpuUsage snapshot / 前回の累積値
 * @param current - Later cumulative cpuUsage snapshot / 今回の累積値
 * @param elapsedMs - Wall time between the two snapshots / 経過時間(ms)
 * @returns Percent in [0, ...] (can exceed 100 on a multi-threaded burst), or
 *   null for a degenerate (non-positive) interval / 消費率(%)
 */
export function computeSelfCpuPercent(
  previous: NodeJS.CpuUsage,
  current: NodeJS.CpuUsage,
  elapsedMs: number,
): number | null {
  if (elapsedMs <= 0) return null;
  const deltaUs = current.user - previous.user + (current.system - previous.system);
  return Math.max(0, (deltaUs / 1000 / elapsedMs) * 100);
}

async function sampleOnce(): Promise<void> {
  try {
    const now = Date.now();
    const current = process.cpuUsage();
    if (lastCpuUsage) {
      const elapsedMs = now - lastSampleAt;
      const cpuPercent = computeSelfCpuPercent(lastCpuUsage, current, elapsedMs);
      if (cpuPercent !== null) {
        // Best-effort context only — a broken import must never stop sampling.
        let activeExecutions: number | null = null;
        try {
          const { agentService } = await import('../agents/agent-service');
          activeExecutions = agentService.getStats().activeExecutions;
        } catch {
          /* context is optional */
        }
        const mem = process.memoryUsage();
        logCycleEvent('system.cpu_sample', {
          cpuPercent: Math.round(cpuPercent * 10) / 10,
          rssMb: Math.round(mem.rss / 1024 / 1024),
          activeExecutions,
          intervalMs: elapsedMs,
        });
      }
    }
    lastCpuUsage = current;
    lastSampleAt = now;
  } catch (err) {
    log.warn({ err }, 'Failed to sample self CPU usage');
  }
}

/**
 * Starts the interval sampler when `RAPITAS_CPU_MONITOR_ENABLED=true`;
 * otherwise a no-op (default behavior is unchanged).
 *
 * @param intervalMs - Sampling interval override, mainly for tests / サンプリング間隔（テスト用）
 */
export function startCpuUsageMonitorIfEnabled(
  intervalMs: number = Number(process.env.RAPITAS_CPU_MONITOR_MS || DEFAULT_INTERVAL_MS),
): void {
  if (process.env.RAPITAS_CPU_MONITOR_ENABLED !== 'true') return;
  if (intervalHandle) return; // already running
  lastCpuUsage = process.cpuUsage();
  lastSampleAt = Date.now();
  intervalHandle = setInterval(() => void sampleOnce(), intervalMs);
  intervalHandle.unref?.();
  log.info({ intervalMs }, '[cpu-usage-monitor] started');
}

/** Stops the sampler and clears state. Used by tests to avoid timer leaks. */
export function stopCpuUsageMonitor(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  lastCpuUsage = null;
  lastSampleAt = 0;
}
