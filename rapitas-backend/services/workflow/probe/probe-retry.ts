/**
 * probe-retry
 *
 * Classifies a probe failure as transient or permanent, and drives one probe
 * target through a timeout + exponential-backoff retry loop. Backoff math is
 * imported unchanged from gh-retry.ts (task 641's proven jittered formula) —
 * this module owns only the probe-specific timeout wrapper and classifier.
 */
import { computeBackoffDelay } from '../../github/gh-retry';
import { sleep } from '../../agents/abstraction/agent-retry';
import type { ProbeContext, ProbeRetryResult, ProbeTarget } from './probe.types';

/** Single strike-through timeout for one probe attempt. */
export const PROBE_TIMEOUT_MS = 3_000;
/** Initial attempt + this many retries = max 3 attempts total. */
export const PROBE_MAX_RETRIES = 2;
export const PROBE_BASE_DELAY_MS = 500;
export const PROBE_MAX_DELAY_MS = 5_000;

/**
 * Infra-layer connectivity/timeout signatures only. Everything else
 * (auth, config, ENOENT, unknown provider, ...) defaults to permanent —
 * mirrors classifyGitHubError's conservative "unknown = unrecoverable" stance
 * so a misconfiguration is never retried forever.
 */
const TRANSIENT_PATTERN =
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|network|timeout|temporarily unavailable/i;

/**
 * Classify a probe failure as transient (worth retrying) or permanent.
 *
 * @param error - Error thrown by a probe target's run(). / probe実行で投げられたエラー
 * @returns Classification. / 分類結果
 */
export function classifyProbeFailure(error: unknown): 'transient' | 'permanent' {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_PATTERN.test(message) ? 'transient' : 'permanent';
}

/**
 * Race a probe attempt against its timeout budget, always clearing the timer.
 * Uses `target.timeoutMs` when set, otherwise the shared PROBE_TIMEOUT_MS.
 */
async function runWithTimeout(
  target: ProbeTarget,
  ctx: ProbeContext,
  attempt: number,
): Promise<void> {
  const timeoutMs = target.timeoutMs ?? PROBE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      target.run(ctx, attempt),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`probe timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Runs a probe target with timeout + classified exponential-backoff retry.
 * A `permanent` classification stops retrying immediately. `transient`
 * failures retry up to PROBE_MAX_RETRIES times; if the FINAL attempt is also
 * transient, the overall outcome is reported as `permanent_failure` (the
 * transient/permanent distinction only controls whether we retry — the
 * caller only cares whether the target is usable after this call returns).
 *
 * @param target - Probe target to execute. / 実行対象のprobe
 * @param ctx - Probe execution context. / 実行コンテキスト
 * @param nowMs - Start-of-attempt clock reading (injected). / 開始時刻(ms)
 * @returns Outcome, attempt count and latency. / 結果・試行回数・所要時間
 */
export async function runProbeWithRetry(
  target: ProbeTarget,
  ctx: ProbeContext,
  nowMs: number,
): Promise<ProbeRetryResult> {
  let attempts = 0;
  let lastErrorMessage: string | null = null;

  for (let attempt = 0; attempt <= PROBE_MAX_RETRIES; attempt++) {
    attempts += 1;
    try {
      await runWithTimeout(target, ctx, attempt);
      return { outcome: 'success', attempts, latencyMs: Date.now() - nowMs, errorMessage: null };
    } catch (err) {
      lastErrorMessage = err instanceof Error ? err.message : String(err);
      const classification = classifyProbeFailure(err);
      if (classification === 'permanent') {
        return {
          outcome: 'permanent_failure',
          attempts,
          latencyMs: Date.now() - nowMs,
          errorMessage: lastErrorMessage,
        };
      }
      if (attempt < PROBE_MAX_RETRIES) {
        const delay = computeBackoffDelay(attempt, PROBE_BASE_DELAY_MS, PROBE_MAX_DELAY_MS);
        await sleep(delay);
      }
    }
  }

  return {
    outcome: 'permanent_failure',
    attempts,
    latencyMs: Date.now() - nowMs,
    errorMessage: lastErrorMessage,
  };
}
