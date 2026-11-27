/**
 * ResourceContentionGate
 *
 * Pure decision function (plus a small in-memory override registry) for
 * whether auto-run's next-task selection should be held back one cycle
 * because rapitas's own processes are busy AND the run is intentionally
 * parallelized (task 725). Task 1553 switched the basis from the host-wide CPU
 * (which includes WebView2, VS Code, Defender and other apps) to rapitas's
 * process tree, so other applications never hold selection, and made the gate
 * default-on. Fails open on every uncertain input — the gate must never stop
 * auto-run on a telemetry gap or the default single-concurrency setup.
 * Not responsible for sampling CPU usage (see resource-telemetry.ts) or for
 * persisting/notifying a hold decision (see auto-run-advance-gates.ts).
 */

/** Default hold threshold: % of host capacity used by rapitas's process tree. */
const DEFAULT_THRESHOLD_PERCENT = 60;

/**
 * Whether the gate is on. Default ON; `false|0|off` disables (same spelling as
 * isLowPriorityEnabled).
 *
 * @returns false only when explicitly disabled. / 明示的に無効化された時だけ false
 */
export function isResourceGateEnabled(): boolean {
  const raw = (process.env.RAPITAS_RESOURCE_GATE_ENABLED ?? '').trim().toLowerCase();
  return !(raw === 'off' || raw === '0' || raw === 'false');
}

/**
 * RAPITAS_RESOURCE_CPU_THRESHOLD_PERCENT, default 60. 60% of a 4-core host is
 * about 2.4 cores — two agents plus a verification overlapping. The old
 * default 85 was set against the host-wide value; rapitas alone almost never
 * reaches it.
 *
 * @returns Threshold in (0, 100]. / しきい値(%)
 */
export function resolveResourceGateThreshold(): number {
  const raw = (process.env.RAPITAS_RESOURCE_CPU_THRESHOLD_PERCENT ?? '').trim();
  const n = raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_THRESHOLD_PERCENT;
}

export interface ResourceGateInput {
  /** Whether the gate is enabled (isResourceGateEnabled). / ゲート有効フラグ */
  enabled: boolean;
  /** WorkflowQueueService.getInstance().getMaxConcurrency(). / 実効並列度 */
  effectiveMaxConcurrency: number;
  /** Tasks already running on the path being selected for; < 1 never holds. / 実行中の件数 */
  activeCount: number;
  /** Latest sampled host CPU busy percentage (reported only). / ホストCPU使用率(%) */
  hostCpuBusyPercent: number | null;
  /** rapitas process-tree CPU, window average; the decision basis. / rapitas の CPU(%) */
  rapitasCpuBusyPercent: number | null;
  /** RAPITAS_RESOURCE_CPU_THRESHOLD_PERCENT. / しきい値(%) */
  thresholdPercent: number;
  /** Whether a one-shot manual override was just consumed for this theme. / 手動オーバーライド消費済みか */
  overridden: boolean;
}

export interface ResourceGateResult {
  hold: boolean;
  /** The value the decision used (rapitas process tree). */
  cpuBusyPercent: number | null;
  /** Host-wide value, for display only. */
  hostCpuBusyPercent: number | null;
  thresholdPercent: number;
  effectiveMaxConcurrency: number;
}

/**
 * Decides whether to hold next-task selection this cycle.
 *
 * @param input - Current gate/telemetry/override state / ゲート判定に必要な入力
 * @returns The hold decision plus the values it was based on / 判定結果と根拠値
 */
export function evaluateResourceGate(input: ResourceGateInput): ResourceGateResult {
  const {
    enabled,
    effectiveMaxConcurrency,
    activeCount,
    hostCpuBusyPercent,
    rapitasCpuBusyPercent,
    thresholdPercent,
    overridden,
  } = input;
  const base: Omit<ResourceGateResult, 'hold'> = {
    cpuBusyPercent: rapitasCpuBusyPercent,
    hostCpuBusyPercent,
    thresholdPercent,
    effectiveMaxConcurrency,
  };
  if (!enabled) return { ...base, hold: false };
  if (effectiveMaxConcurrency <= 1) return { ...base, hold: false };
  // Only the 2nd and later selections are held: the first task always starts.
  if (activeCount < 1) return { ...base, hold: false };
  if (rapitasCpuBusyPercent === null) return { ...base, hold: false }; // fail open
  if (overridden) return { ...base, hold: false };
  return { ...base, hold: rapitasCpuBusyPercent >= thresholdPercent };
}

// One-shot manual override registry: a theme id maps to the epoch ms the
// override was requested. consumeResourceGateOverride deletes on read, so a
// single "今すぐ実行" click only bypasses exactly the next gate check.
const pendingOverrides = new Map<number, number>();

/**
 * Records a one-shot override request for a theme (the dashboard's "今すぐ実行").
 *
 * @param themeId - Theme requesting the bypass / 対象テーマ
 */
export function requestResourceGateOverride(themeId: number): void {
  pendingOverrides.set(themeId, Date.now());
}

/**
 * Consumes (and removes) a pending override for a theme, if any.
 *
 * @param themeId - Theme being evaluated by the gate / 対象テーマ
 * @returns Whether an override was pending and is now consumed / オーバーライドが存在し消費されたか
 */
export function consumeResourceGateOverride(themeId: number): boolean {
  if (!pendingOverrides.has(themeId)) return false;
  pendingOverrides.delete(themeId);
  return true;
}
