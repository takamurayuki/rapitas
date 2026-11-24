/**
 * verify-claim
 *
 * Parses the machine-readable `json:verify-claim` block of a verify.md and
 * reconciles it with what the self-verification job (POST /run-verification)
 * actually measured. It does not read the report's prose.
 * It is NOT responsible for fetching the job (see verify-claim-loader.ts) or
 * for the legacy wording-based detection (phase-output-validator.ts).
 */

/** Claim a verify.md makes about its own result. / 検証レポートの主張 */
import { quoteEvidenceLine } from './verify-repeat-evidence';

export interface VerifyClaim {
  version: 1;
  overall: 'success' | 'failure';
  runId: string;
  sha: string;
  tests: { ran: boolean; failed: number; passed?: number };
}

/** The subset of a verification job that the reconciliation reads. / 照合に使う実測の最小形 */
export interface MeasuredJob {
  status: string;
  ok?: boolean;
  unverifiable?: boolean;
  revision?: string | null;
  checks?: Array<{ name: string; ran: boolean; errorCount: number }>;
}

/** Measured evidence handed to the validator. `job: null` means no job could be found. / 実測の受け渡し形 */
export interface MeasuredVerification {
  job: MeasuredJob | null;
  /** Set when the lookup itself threw, so the rejection can say so. / 取得に失敗した場合の理由 */
  fetchError?: string;
}

export type VerifyClaimRejectCode =
  | 'claim-malformed'
  | 'job-missing'
  | 'job-not-completed'
  | 'job-not-ok'
  | 'sha-mismatch'
  | 'count-mismatch'
  | 'claim-contradicts-job';

/** Outcome of checking a report against the measured job. / 照合結果 */
export type VerifyClaimVerdict =
  | { kind: 'none' }
  | { kind: 'accepted' }
  // A failure claim backed by a failing job: the report itself is a failed verdict.
  | { kind: 'failure-claim'; evidence: string }
  | { kind: 'rejected'; code: VerifyClaimRejectCode; message: string };

// Fences are line-anchored so prose that merely names the fence is not a block.
const FENCE = /^```json:verify-claim[ \t]*\r?\n([\s\S]*?)^```/gm;
const OPEN_FENCE = /^```json:verify-claim[ \t]*\r?$/gm;

type ParseResult =
  | { kind: 'none' }
  | { kind: 'malformed'; reason: string }
  | { kind: 'ok'; claim: VerifyClaim };

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Extract and type-check the single `json:verify-claim` block.
 *
 * @param content - verify.md body. / verify.md 本文
 * @returns `none` without a block, `malformed` for a broken or duplicate block, else the claim. / 主張の抽出結果
 */
export function parseVerifyClaim(content: string): ParseResult {
  const blocks = [...content.matchAll(FENCE)];
  // An opening fence with no closing one must not read as 'no claim' (legacy path).
  const opens = [...content.matchAll(OPEN_FENCE)].length;
  if (opens > blocks.length)
    return { kind: 'malformed', reason: 'unclosed json:verify-claim block' };
  if (blocks.length === 0) return { kind: 'none' };
  if (blocks.length > 1) return { kind: 'malformed', reason: 'multiple json:verify-claim blocks' };
  let raw: unknown;
  try {
    raw = JSON.parse(blocks[0][1]);
  } catch {
    return { kind: 'malformed', reason: 'block is not valid JSON' };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { kind: 'malformed', reason: 'block is not a JSON object' };
  }
  const c = raw as Record<string, unknown>;
  const t = c.tests as Record<string, unknown> | null | undefined;
  if (c.version !== 1) return { kind: 'malformed', reason: 'version must be 1' };
  if (c.overall !== 'success' && c.overall !== 'failure') {
    return { kind: 'malformed', reason: 'overall must be "success" or "failure"' };
  }
  if (typeof c.runId !== 'string' || c.runId.trim() === '') {
    return { kind: 'malformed', reason: 'runId is required' };
  }
  if (typeof c.sha !== 'string' || c.sha.trim() === '') {
    return { kind: 'malformed', reason: 'sha is required' };
  }
  if (typeof t !== 'object' || t === null || typeof t.ran !== 'boolean' || !isCount(t.failed)) {
    return {
      kind: 'malformed',
      reason: 'tests.ran (boolean) and tests.failed (integer) are required',
    };
  }
  if (t.passed !== undefined && !isCount(t.passed)) {
    return { kind: 'malformed', reason: 'tests.passed must be a non-negative integer' };
  }
  return {
    kind: 'ok',
    claim: {
      version: 1,
      overall: c.overall,
      runId: c.runId.trim(),
      sha: c.sha.trim(),
      tests: {
        ran: t.ran,
        failed: t.failed,
        ...(t.passed !== undefined ? { passed: t.passed } : {}),
      },
    },
  };
}

function reject(code: VerifyClaimRejectCode, message: string): VerifyClaimVerdict {
  return {
    kind: 'rejected',
    code,
    message: `verify-claim ${code}: ${message} ${quoteEvidenceLine(message)}`,
  };
}

/**
 * Reconcile a verify.md's claim with the measured job.
 *
 * The count source of truth is the structured `checks[name='test']` entry of the
 * job: `ran` and `errorCount` (failures). `tests.passed` is type-checked only —
 * the job records no structured pass count and `details` free text is never parsed.
 * SHA must equal the job's recorded revision exactly (no ancestor logic).
 *
 * @param content - verify.md body. / verify.md 本文
 * @param measured - Job looked up by the claimed runId; undefined when not supplied. / 主張の runId で引いた実測
 * @returns Verdict; `none` means no claim block, so legacy wording checks apply. / 照合結果
 */
export function checkVerifyClaim(
  content: string,
  measured: MeasuredVerification | undefined,
): VerifyClaimVerdict {
  const parsed = parseVerifyClaim(content);
  if (parsed.kind === 'none') return { kind: 'none' };
  if (parsed.kind === 'malformed') return reject('claim-malformed', parsed.reason);
  const { claim } = parsed;
  const job = measured?.job ?? null;
  if (!job) {
    const why = measured?.fetchError ? ` (lookup failed: ${measured.fetchError})` : '';
    return reject('job-missing', `no verification job found for runId ${claim.runId}${why}`);
  }
  const jobPassed = job.status === 'completed' && job.ok === true && job.unverifiable !== true;
  if (claim.overall === 'failure') {
    if (jobPassed) {
      return reject('claim-contradicts-job', `report claims failure but job ${claim.runId} passed`);
    }
    const test = job.checks?.find((c) => c.name === 'test');
    return {
      kind: 'failure-claim',
      // 本文に未達行がなくても、主張と構造化された実測を反復検知の証拠にする。
      evidence: quoteEvidenceLine(
        `overall=failure; test ran=${test?.ran ?? false} failed=${test?.errorCount ?? 0}; job status=${job.status} ok=${String(job.ok)} unverifiable=${job.unverifiable === true}`,
      ),
    };
  }
  if (job.status !== 'completed') {
    return reject('job-not-completed', `job ${claim.runId} status is ${job.status}`);
  }
  if (job.ok !== true || job.unverifiable === true) {
    return reject(
      'job-not-ok',
      `report claims success but job ${claim.runId} measured ok=${String(job.ok)} unverifiable=${String(job.unverifiable === true)}`,
    );
  }
  if (job.revision !== claim.sha) {
    return reject(
      'sha-mismatch',
      `claimed sha ${claim.sha} differs from job revision ${job.revision ?? 'unknown'}; re-run self-verification on the last commit and cite its runId`,
    );
  }
  const test = job.checks?.find((c) => c.name === 'test');
  const measuredRan = test?.ran ?? false;
  if (claim.tests.ran !== measuredRan) {
    return reject(
      'count-mismatch',
      `tests.ran claimed ${claim.tests.ran}, measured ${measuredRan}`,
    );
  }
  // Compared even when the test check did not run: a claimed failure count must equal the measured one (0 when absent).
  const measuredFailed = test?.errorCount ?? 0;
  if (claim.tests.failed !== measuredFailed) {
    return reject(
      'count-mismatch',
      `tests.failed claimed ${claim.tests.failed}, measured ${measuredFailed}`,
    );
  }
  return { kind: 'accepted' };
}
