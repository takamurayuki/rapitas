/**
 * Git Retry Telemetry
 *
 * Records retry metrics for `runGitCommandWithRetry` executions to the
 * `GitRetryMetric` table. Writes are fire-and-forget and fail-open:
 * a DB error never interrupts the git retry operation itself.
 *
 * Disable telemetry by setting `RAPITAS_GIT_RETRY_TELEMETRY=0`.
 */

import { createLogger } from '../../config/logger';
import { prisma } from '../../config/database';
import type { GitErrorCategory } from './git-exec';

const log = createLogger('github-service:git-retry-telemetry');

const TELEMETRY_ENABLED = process.env.RAPITAS_GIT_RETRY_TELEMETRY !== '0';

/** Input shape for a single retry-metric record. */
export interface GitRetryMetricInput {
  /** Active variant name (e.g. `"default"`, `"aggressive"`, or `"explicit"`). */
  variant: string;
  /** Git subcommand — `args[0]` only to avoid PII/path leakage. */
  command: string;
  /** Total attempt count including the first try. */
  attempts: number;
  /** Whether the final attempt succeeded. */
  succeeded: boolean;
  /** Accumulated backoff delay in milliseconds (jitter-inclusive real measurement). */
  totalDelayMs: number;
  /** Wall-clock time from first attempt to final outcome in milliseconds. */
  totalElapsedMs: number;
  /** Error category of the final failure, or undefined on success. */
  finalErrorCategory?: GitErrorCategory;
  /** `baseDelay` from the active policy (for theoretical comparison). */
  baseDelay: number;
  /** `maxDelay` from the active policy. */
  maxDelay: number;
  /** `maxRetries` from the active policy. */
  maxRetries: number;
}

interface GitRetryMetricClient {
  create(args: {
    data: {
      variant: string;
      command: string;
      attempts: number;
      succeeded: boolean;
      totalDelayMs: number;
      totalElapsedMs: number;
      finalErrorCategory: string | null;
      baseDelay: number;
      maxDelay: number;
      maxRetries: number;
    };
  }): Promise<unknown>;
}

/**
 * Persist a retry-metric record asynchronously (fire-and-forget, fail-open).
 * Does nothing when `RAPITAS_GIT_RETRY_TELEMETRY=0`.
 *
 * @param input - Metric fields / メトリクスフィールド
 */
export function recordGitRetryMetric(input: GitRetryMetricInput): void {
  if (!TELEMETRY_ENABLED) return;

  // HACK(agent): gitRetryMetric is not yet in PrismaClient typings until `prisma generate`
  // runs after server restart. Access via record cast to avoid a compile error before restart.
  const metricClient = (prisma as unknown as Record<string, unknown>)['gitRetryMetric'] as
    GitRetryMetricClient | undefined;

  if (!metricClient) {
    log.debug('gitRetryMetric model not yet available (pending prisma generate)');
    return;
  }

  void metricClient
    .create({
      data: {
        variant: input.variant,
        command: input.command,
        attempts: input.attempts,
        succeeded: input.succeeded,
        totalDelayMs: input.totalDelayMs,
        totalElapsedMs: input.totalElapsedMs,
        finalErrorCategory: input.finalErrorCategory ?? null,
        baseDelay: input.baseDelay,
        maxDelay: input.maxDelay,
        maxRetries: input.maxRetries,
      },
    })
    .catch((err: unknown) => {
      // NOTE: fail-open — a DB write failure must not propagate to the caller.
      const message = err instanceof Error ? err.message : String(err);
      log.debug({ err: message }, 'git retry telemetry write failed (non-fatal)');
    });
}
