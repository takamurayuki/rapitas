/**
 * verify-claim-loader
 *
 * Looks up the self-verification job a verify.md cites in its `json:verify-claim`
 * block, so the three validateVerify call sites share one fetch path.
 * It does not judge the report; that is verify-claim.ts.
 */
import { getJobByRunId } from './verification-job-store';
import { parseVerifyClaim, type MeasuredVerification } from './verify-claim';

/**
 * Fetch the measured job for the claim in a verify.md.
 *
 * @param taskId - Task the report belongs to; jobs of other tasks are never returned. / 対象タスクID
 * @param content - verify.md body. / verify.md 本文
 * @returns undefined when there is no usable claim (nothing to look up); otherwise the job or a fetch error. / 実測。主張が無ければ undefined
 */
export async function loadMeasuredVerification(
  taskId: number,
  content: string,
): Promise<MeasuredVerification | undefined> {
  const parsed = parseVerifyClaim(content);
  if (parsed.kind !== 'ok') return undefined;
  try {
    const job = await getJobByRunId(taskId, parsed.claim.runId);
    return { job };
  } catch (error) {
    // Fail closed: an unreadable job must not let a success claim through.
    return { job: null, fetchError: error instanceof Error ? error.message : String(error) };
  }
}
