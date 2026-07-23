/**
 * GitHub Retry Utilities
 *
 * Error classifier, exponential-backoff retry wrapper, and idempotency-aware
 * retry policy presets for GitHub CLI (gh) operations. Independent of the AI
 * provider retry infrastructure in agent-retry.ts — GitHub and AI error
 * categories carry different meanings and must not share a classifier.
 */

import { sleep } from '../agents/abstraction/agent-retry';

/**
 * Broad categories used to decide whether and how to retry a gh CLI failure.
 * `unrecoverable` is the conservative default for unrecognized errors.
 */
export type GitHubErrorCategory =
  'rate_limit' | 'transient' | 'head_behind' | 'auth' | 'not_found' | 'unrecoverable';

interface ClassificationRule {
  pattern: RegExp;
  category: GitHubErrorCategory;
}

/**
 * Ordered rules — first match wins.
 * Auth is checked before rate_limit to prevent a 401 message from false-matching a 403 rule.
 */
const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    pattern: /not (authenticated|logged in)|bad credentials|authentication.*expired|\bHTTP 401\b/i,
    category: 'auth',
  },
  {
    pattern:
      /API rate limit exceeded|\b403\b.*rate limit|secondary rate limit|You have exceeded a secondary rate limit/i,
    category: 'rate_limit',
  },
  {
    pattern:
      /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|network is unreachable|\b50[0234]\b|timeout/i,
    category: 'transient',
  },
  {
    pattern: /not up.?to.?date with the base branch|not mergeable|base branch was modified/i,
    category: 'head_behind',
  },
  {
    pattern: /\b404\b|could not resolve to a|no pull requests found/i,
    category: 'not_found',
  },
];

/**
 * Classify a gh CLI error message into a retry-relevant category.
 * Unrecognized messages return `unrecoverable` (conservative: no blind retries).
 *
 * @param message - Raw error message from gh CLI / ghエラーメッセージ
 * @returns Error category / エラーカテゴリ
 */
export function classifyGitHubError(message: string): GitHubErrorCategory {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(message)) return rule.category;
  }
  return 'unrecoverable';
}

/** Configuration for a retry attempt loop. */
export interface GhRetryOptions {
  /** Error categories that permit a retry attempt. */
  retryOn: GitHubErrorCategory[];
  /** Maximum number of retry attempts after the first failure. */
  maxRetries: number;
  /** Base delay in milliseconds; actual delay is exponentially scaled. */
  baseDelay: number;
  /** Hard cap on computed delay in milliseconds to prevent excessive waits. */
  maxDelay: number;
}

/** Named alias used for preset constants. */
export type GhRetryPolicy = GhRetryOptions;

/**
 * Policy for idempotent read operations (GET / list / view).
 * Retries both rate_limit and transient network failures — no side-effect risk.
 */
export const READ_RETRY_POLICY: GhRetryPolicy = {
  retryOn: ['rate_limit', 'transient'],
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
};

/**
 * Policy for non-idempotent write operations (create / merge / comment).
 * Only retries rate_limit — GitHub rejects these before processing, making
 * them safe to retry even for non-idempotent writes. Excludes transient to
 * prevent duplicate resource creation on post-send disconnects.
 */
export const WRITE_RETRY_POLICY: GhRetryPolicy = {
  retryOn: ['rate_limit'],
  maxRetries: 2,
  baseDelay: 2000,
  maxDelay: 30000,
};

/**
 * Policy for short-lived polling loops (e.g. watcher ticks).
 * Caps max delay to 8 s to avoid stalling the caller for more than one tick.
 */
export const POLL_RETRY_POLICY: GhRetryPolicy = {
  retryOn: ['rate_limit', 'transient'],
  maxRetries: 2,
  baseDelay: 500,
  maxDelay: 8000,
};

/**
 * Compute the exponential backoff delay for a given attempt, plus up to 30% jitter.
 * Formula: `min(maxDelay, base * 2^attempt) + jitter`, jitter ∈ [0, base * 0.3).
 *
 * @param attempt - Zero-based attempt index / 0始まりの試行インデックス
 * @param baseDelay - Base delay in ms / 基本遅延ミリ秒
 * @param maxDelay - Maximum delay cap in ms / 最大遅延キャップミリ秒
 * @returns Delay in ms / ディレイミリ秒
 */
export function computeBackoffDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const exponential = baseDelay * Math.pow(2, attempt);
  const clamped = Math.min(exponential, maxDelay);
  const jitter = baseDelay * Math.random() * 0.3;
  return Math.floor(clamped + jitter);
}

/**
 * Execute fn with exponential-backoff retries according to the given policy.
 * Immediately re-throws for non-retryable categories (auth, not_found, head_behind, unrecoverable).
 * On maxRetries exhaustion the last error is re-thrown unchanged so callers can handle it.
 *
 * @param fn - Async operation to attempt / 実行する非同期操作
 * @param policy - Retry policy (default: READ_RETRY_POLICY) / リトライポリシー
 * @returns Result of fn / fnの結果
 * @throws {Error} Last error on retry exhaustion or non-retryable category / リトライ上限または非リトライカテゴリ時
 */
export async function withGhRetry<T>(
  fn: () => Promise<T>,
  policy: GhRetryPolicy = READ_RETRY_POLICY,
): Promise<T> {
  let lastError: Error = new Error('Unknown gh error');

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const category = classifyGitHubError(lastError.message);
      const shouldRetry = policy.retryOn.includes(category) && attempt < policy.maxRetries;

      if (!shouldRetry) throw lastError;

      const delay = computeBackoffDelay(attempt, policy.baseDelay, policy.maxDelay);
      await sleep(delay);
    }
  }

  // NOTE: Unreachable — the loop always returns or throws via the `if (!shouldRetry)` guard above.
  throw lastError;
}

/**
 * Returns true when the error message indicates the PR head branch is behind its base.
 * Extracted from branch-pr-ops.ts so the detection regex is shared and testable.
 *
 * @param message - Error message from a gh pr merge failure / ghマージ失敗エラーメッセージ
 * @returns Whether the head branch is behind the base / headがbaseより遅れているか
 */
export function isHeadBehindError(message: string): boolean {
  return /not up.?to.?date with the base branch|not mergeable|base branch was modified/i.test(
    message,
  );
}

/**
 * Returns true when the error from gh pr update-branch indicates the branch
 * was already up to date (the sync was a no-op; caller should retry the merge).
 *
 * @param message - Error message from gh pr update-branch / update-branchエラーメッセージ
 * @returns Whether the branch was already up to date / ブランチが既に最新か
 */
export function isAlreadyUpToDate(message: string): boolean {
  return /already up.?to.?date|no new commits|not behind/i.test(message);
}
