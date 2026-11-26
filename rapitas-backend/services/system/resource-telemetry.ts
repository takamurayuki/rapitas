/**
 * ResourceTelemetry
 *
 * CPU sampler for the resource-contention gate (task 725). Two values:
 * - host-wide busy % from `os.cpus()` tick deltas (cheap; display only since
 *   task 1553 — it includes every other application on the machine);
 * - rapitas's own process-tree CPU (backend + agents + verification children),
 *   averaged over RAPITAS_RESOURCE_CPU_WINDOW_MS (default 5 min). This is the
 *   gate's decision basis.
 * The tree snapshot needs one CIM call on Windows, which is not free (the
 * dev.js RSS watchdog measured it), so it runs only when `shouldSample()`
 * says the gate could hold at all (parallelism > 1) and never twice at once.
 * `os.loadavg()` is not used because it always returns `[0, 0, 0]` on Windows.
 * Not responsible for deciding whether to hold auto-run selection — see
 * services/workflow/auto-run/resource-contention-gate.ts.
 */
import os, { cpus } from 'os';
import { createLogger } from '../../config/logger';
import { isResourceGateEnabled } from '../workflow/auto-run/resource-contention-gate';
import {
  collectTree,
  computeIntervalCpuMs,
  readProcessSnapshot,
  windowAveragePercent,
  type CpuInterval,
  type ProcSample,
} from './rapitas-process-cpu';

const log = createLogger('resource-telemetry');

const DEFAULT_SAMPLE_INTERVAL_MS = 30_000;
const DEFAULT_CPU_WINDOW_MS = 300_000;

interface CpuTickTotals {
  idle: number;
  total: number;
}

/** Injectable collaborators for the sampler. */
export interface ResourceTelemetryOptions {
  /** false → skip the (costly) process-tree snapshot this tick. Default: always. */
  shouldSample?: () => boolean;
  /** Snapshot reader override for tests. */
  readSnapshot?: () => Promise<{ rows: ProcSample[]; samplerPid?: number }>;
  /** Clock override for tests. */
  now?: () => number;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastTotals: CpuTickTotals | null = null;
let cachedBusyPercent: number | null = null;

let opts: Required<ResourceTelemetryOptions> = defaultOptions();
let prevTree: ProcSample[] | null = null;
let prevTreeAt = 0;
let treeIntervals: CpuInterval[] = [];
let treeInFlight: Promise<void> | null = null;

function defaultOptions(): Required<ResourceTelemetryOptions> {
  return { shouldSample: () => true, readSnapshot: readProcessSnapshot, now: Date.now };
}

/**
 * Averaging window for the rapitas CPU (RAPITAS_RESOURCE_CPU_WINDOW_MS, default 5 min).
 *
 * @returns Window length in ms. / 平均の窓（ms）
 */
export function getRapitasCpuWindowMs(): number {
  const n = Number(process.env.RAPITAS_RESOURCE_CPU_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CPU_WINDOW_MS;
}

function hostCores(): number {
  return typeof os.availableParallelism === 'function' ? os.availableParallelism() : cpus().length;
}

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

function sampleHost(): void {
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

/** One process-tree snapshot; skipped while the previous one is still running. */
function sampleTree(): Promise<void> {
  if (treeInFlight) return treeInFlight; // a slow CIM call must not stack up
  if (!opts.shouldSample()) {
    // The gate cannot hold right now; drop the baseline so the next interval
    // does not span the skipped time.
    prevTree = null;
    return Promise.resolve();
  }
  treeInFlight = opts
    .readSnapshot()
    .then(({ rows, samplerPid }) => {
      const at = opts.now();
      const exclude = new Set<number>(samplerPid === undefined ? [] : [samplerPid]);
      const tree = collectTree(rows, process.pid, exclude);
      if (tree.length === 0) return; // own pid missing from the snapshot: no data
      if (prevTree && at > prevTreeAt) {
        treeIntervals.push({
          at,
          cpuMs: computeIntervalCpuMs(prevTree, tree),
          elapsedMs: at - prevTreeAt,
        });
        const oldest = at - getRapitasCpuWindowMs();
        treeIntervals = treeIntervals.filter((i) => i.at >= oldest);
      }
      prevTree = tree;
      prevTreeAt = at;
    })
    .catch((err) => {
      log.warn({ err }, 'Failed to sample rapitas process CPU usage');
    })
    .finally(() => {
      treeInFlight = null;
    });
  return treeInFlight;
}

/**
 * Takes one host + process-tree sample now. The interval timer calls this;
 * exported for tests and measurements.
 *
 * @returns Resolves when the process-tree snapshot has been recorded. / 記録完了で解決
 */
export function sampleResourceTelemetryNow(): Promise<void> {
  sampleHost();
  return sampleTree();
}

/**
 * Starts the interval sampler unless the gate is disabled
 * (RAPITAS_RESOURCE_GATE_ENABLED=false|0|off). Default ON since task 1553.
 *
 * @param intervalMs - Sampling interval override, mainly for tests / サンプリング間隔（テスト用）
 * @param options - shouldSample / snapshot / clock overrides / 差し替え
 */
export function startResourceTelemetryIfEnabled(
  intervalMs: number = Number(
    process.env.RAPITAS_RESOURCE_SAMPLE_INTERVAL_MS || DEFAULT_SAMPLE_INTERVAL_MS,
  ),
  options: ResourceTelemetryOptions = {},
): void {
  if (!isResourceGateEnabled()) return;
  if (intervalHandle) return; // already running
  opts = { ...defaultOptions(), ...options };
  void sampleResourceTelemetryNow();
  intervalHandle = setInterval(() => void sampleResourceTelemetryNow(), intervalMs);
  intervalHandle.unref?.();
}

/** Stops the sampler and clears the cache. Used by tests to avoid timer leaks. */
export function stopResourceTelemetry(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  lastTotals = null;
  cachedBusyPercent = null;
  prevTree = null;
  prevTreeAt = 0;
  treeIntervals = [];
  treeInFlight = null;
  opts = defaultOptions();
}

/**
 * Returns the most recent sampled host CPU busy percentage (all applications).
 *
 * @returns Busy percentage in [0, 100], or `null` before the first completed sample / 未サンプリング時はnull
 */
export function getHostCpuBusyPercent(): number | null {
  return cachedBusyPercent;
}

/**
 * rapitas process-tree CPU averaged over the window, as % of host capacity.
 *
 * @param now - Current time (defaults to the sampler clock). / 現在時刻
 * @returns Percent in [0, 100], or null with fewer than two snapshots in the window. / 2回未満なら null
 */
export function getRapitasCpuBusyPercent(now: number = opts.now()): number | null {
  return windowAveragePercent(treeIntervals, getRapitasCpuWindowMs(), hostCores(), now);
}
