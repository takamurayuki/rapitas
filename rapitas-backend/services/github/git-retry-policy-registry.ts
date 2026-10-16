/**
 * Git Retry Policy Registry
 *
 * Declares named retry-policy variants for `runGitCommandWithRetry` and resolves
 * the active variant from the `RAPITAS_GIT_RETRY_VARIANT` environment variable.
 * Unknown variant names fall back to `default` so a typo cannot break git operations.
 *
 * NOTE: This module uses `import type` only from git-exec to avoid a circular
 * dependency at runtime. The `default` variant values are intentionally duplicated
 * from `GIT_READ_RETRY_POLICY` — keep them in sync if that constant ever changes.
 */

import { createLogger } from '../../config/logger';
import type { GitRetryPolicy } from './git-exec';

const log = createLogger('github-service:git-retry-policy-registry');

/**
 * Named retry-policy variants available for A/B experimentation.
 *
 * - `default`      : identical to `GIT_READ_RETRY_POLICY` (baseline, no behaviour change)
 * - `aggressive`   : more retries with a shorter initial backoff (faster recovery on flaky networks)
 * - `conservative` : fewer retries but longer maximum wait (fewer false attempts on slow links)
 */
export const GIT_RETRY_VARIANTS: Record<string, GitRetryPolicy> = {
  // NOTE: Values must match GIT_READ_RETRY_POLICY in git-exec.ts exactly.
  // Circular import avoided by duplicating the literal here instead of importing the value.
  default: {
    retryOn: ['transient'],
    maxRetries: 2,
    baseDelay: 500,
    maxDelay: 8000,
  },
  aggressive: {
    retryOn: ['transient'],
    maxRetries: 5,
    baseDelay: 200,
    maxDelay: 8000,
  },
  conservative: {
    retryOn: ['transient'],
    maxRetries: 1,
    baseDelay: 500,
    maxDelay: 16000,
  },
};

const ENV_VAR = 'RAPITAS_GIT_RETRY_VARIANT';

/**
 * Return the name of the currently active retry variant.
 * Reads `RAPITAS_GIT_RETRY_VARIANT` and validates it against the registry.
 * Falls back to `'default'` when the variable is unset or unknown.
 *
 * @returns Active variant name / アクティブなバリアント名
 */
export function getActiveVariantName(): string {
  const raw = process.env[ENV_VAR];
  if (!raw) return 'default';

  if (raw in GIT_RETRY_VARIANTS) return raw;

  // NOTE: warn once per unknown value — do not throw, so a typo never breaks git operations.
  log.warn(
    { variant: raw, knownVariants: Object.keys(GIT_RETRY_VARIANTS) },
    `Unknown ${ENV_VAR} value "${raw}"; falling back to "default"`,
  );
  return 'default';
}

/**
 * Resolve the active `GitRetryPolicy` from the registry.
 * Reads `RAPITAS_GIT_RETRY_VARIANT`; unknown names fall back to `default` with a warn.
 *
 * @returns Active retry policy / アクティブなリトライポリシー
 */
export function resolveActiveGitRetryPolicy(): GitRetryPolicy {
  return GIT_RETRY_VARIANTS[getActiveVariantName()];
}
