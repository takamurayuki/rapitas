/**
 * pr-guards
 *
 * Shared pre-flight guard helpers for PR mutation endpoints.
 * Returns a violation descriptor (status + body) when a guard fails, or null
 * when the PR is actionable.  Callers apply `context.set.status` inline,
 * keeping the existing github.ts response style intact.
 */

/** Returned by checkPrActionable when the request should be rejected. */
export interface PrGuardViolation {
  /** HTTP status to set on the response: 422 or 409. */
  status: 422 | 409;
  body: { success: false; error: string };
}

/**
 * Checks whether a PR record allows the requested mutation to proceed.
 *
 * Two guards are applied in order:
 *   1. prNumber validity — rejects with 422 when prNumber is not a positive
 *      integer (an invalid number would produce a meaningless gh CLI call).
 *   2. state pre-check — rejects with 409 when requireOpen is true and the PR
 *      is not in 'open' state (merged/closed PRs cannot be mutated).
 *
 * @param pr - PR record with at least prNumber and state fields.
 * @param opts.operationLabel - Human-readable operation name for the error message (e.g. 'base変更').
 * @param opts.requireOpen - When true, non-open PRs are rejected with 409.
 * @returns PrGuardViolation when a guard fires, null when the PR is actionable.
 */
export function checkPrActionable(
  pr: { prNumber: number; state: string },
  opts: { operationLabel: string; requireOpen: boolean },
): PrGuardViolation | null {
  if (!Number.isInteger(pr.prNumber) || pr.prNumber <= 0) {
    return {
      status: 422,
      body: {
        success: false,
        error: `PRの番号が不正なため ${opts.operationLabel} を実行できません (prNumber=${pr.prNumber})`,
      },
    };
  }

  if (opts.requireOpen && pr.state !== 'open') {
    return {
      status: 409,
      body: {
        success: false,
        error: `PRがopen状態ではないため ${opts.operationLabel} を実行できません (state=${pr.state})`,
      },
    };
  }

  return null;
}
