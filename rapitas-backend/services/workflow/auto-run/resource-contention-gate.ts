/**
 * ResourceContentionGate
 *
 * Pure decision function (plus a small in-memory override registry) for
 * whether auto-run's next-task selection should be held back one cycle
 * because the host CPU is busy AND the run is intentionally parallelized
 * (task 725). Fails open on every uncertain input — the gate must never stop
 * auto-run on a telemetry gap or the default single-concurrency setup.
 * Not responsible for sampling CPU usage (see resource-telemetry.ts) or for
 * persisting/notifying a hold decision (see auto-run-advance-select.ts).
 */

export interface ResourceGateInput {
  /** Whether RAPITAS_RESOURCE_GATE_ENABLED=true. / ゲート有効フラグ */
  enabled: boolean;
  /** WorkflowQueueService.getInstance().getMaxConcurrency(). / 実効並列度 */
  effectiveMaxConcurrency: number;
  /** Latest sampled host CPU busy percentage, or null if unsampled. / ホストCPU使用率(%) */
  hostCpuBusyPercent: number | null;
  /** RAPITAS_RESOURCE_CPU_THRESHOLD_PERCENT. / しきい値(%) */
  thresholdPercent: number;
  /** Whether a one-shot manual override was just consumed for this theme. / 手動オーバーライド消費済みか */
  overridden: boolean;
}

export interface ResourceGateResult {
  hold: boolean;
  cpuBusyPercent: number | null;
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
  const { enabled, effectiveMaxConcurrency, hostCpuBusyPercent, thresholdPercent, overridden } =
    input;
  const base: Omit<ResourceGateResult, 'hold'> = {
    cpuBusyPercent: hostCpuBusyPercent,
    thresholdPercent,
    effectiveMaxConcurrency,
  };
  if (!enabled) return { ...base, hold: false };
  if (effectiveMaxConcurrency <= 1) return { ...base, hold: false };
  if (hostCpuBusyPercent === null) return { ...base, hold: false }; // fail open
  if (overridden) return { ...base, hold: false };
  return { ...base, hold: hostCpuBusyPercent >= thresholdPercent };
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
