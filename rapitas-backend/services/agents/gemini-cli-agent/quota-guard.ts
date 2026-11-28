/**
 * GeminiCliAgent — Quota Guard
 *
 * Detects gemini-cli's internal 429 / quota retry loop in its output and
 * aborts the CLI so the orchestrator can fall back to another provider.
 * Moved unchanged out of stream-handler.ts (300-line threshold).
 */
import type { ChildProcess } from 'child_process';
import { createLogger } from '../../../config/logger';
import type { StreamHandlerCallbacks } from './stream-handler';

const logger = createLogger('gemini-cli-agent:stream-handler');

/**
 * Create the per-process quota signal checker.
 *
 * @param proc - Gemini CLI process / GeminiCLIプロセス
 * @param logPrefix - Log prefix / ログ識別プレフィックス
 * @param callbacks - Output and kill callbacks / 出力・停止コールバック
 * @returns Checker to call with every stdout/stderr chunk / 出力ごとに呼ぶ判定関数
 */
export function createGeminiQuotaGuard(
  proc: ChildProcess,
  logPrefix: string,
  callbacks: Pick<StreamHandlerCallbacks, 'onOutput' | 'onKillProcess'>,
): (output: string) => void {
  // Track gemini CLI's internal 429 retry loop. The CLI retries up to 10
  // times with exponential backoff before giving up — 5-7 minutes wasted.
  // Detect quota signals (any of the variants below) and short-circuit so
  // the orchestrator can fall back to claude/codex.
  //
  // Variants we have observed in real logs:
  //   `Attempt 1 failed with status 429. Retrying with backoff...`
  //   `Attempt 10 failed: No capacity available for model gemini-2.5-flash`
  //   `RetryableQuotaError: No capacity available...`
  //   `Quota exceeded for quota metric ...`
  //   bare `status: 429` in nested error chains
  // The previous detector only matched the first variant and was bypassed
  // when the chunk split mid-message or the first occurrence used variant 2.
  let geminiQuotaHits = 0;
  let geminiKillScheduled = false;
  const GEMINI_QUOTA_KILL_THRESHOLD = 2;
  const QUOTA_PATTERNS: RegExp[] = [
    /Attempt \d+ failed.*(429|status\s*429|No capacity)/i,
    /RetryableQuotaError|ResourceExhaustedError/i,
    /No capacity available for model/i,
    /Quota exceeded/i,
    /resource_exhausted/i,
    /Max attempts reached/i,
  ];

  return function checkGeminiQuotaSignal(output: string): void {
    if (geminiKillScheduled || proc.killed) return;
    let hits = 0;
    for (const re of QUOTA_PATTERNS) {
      const m = output.match(new RegExp(re.source, re.flags + 'g'));
      if (m) hits += m.length;
    }
    if (hits === 0) return;
    geminiQuotaHits += hits;
    if (geminiQuotaHits < GEMINI_QUOTA_KILL_THRESHOLD) return;
    geminiKillScheduled = true;
    logger.warn(
      { logPrefix, hits: geminiQuotaHits },
      `Gemini hit quota/rate-limit signals (${geminiQuotaHits}× ≥ ${GEMINI_QUOTA_KILL_THRESHOLD}) — placing provider in cooldown and aborting CLI so orchestrator can fall back`,
    );
    callbacks.onOutput(
      `\n[Rapitas] Gemini API がレート/クオータ上限に達したためリトライを打ち切り、別プロバイダにフォールバックします。\n`,
      true,
    );
    import('../../ai/provider-cooldown')
      .then(({ markProviderCooldown }) => {
        markProviderCooldown('gemini', 'rate_limit', undefined, {
          message: 'gemini-cli quota / rate-limit signals detected',
        });
      })
      .catch(() => {});
    callbacks.onKillProcess();
  };
}
