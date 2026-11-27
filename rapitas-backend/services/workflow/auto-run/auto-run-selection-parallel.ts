/**
 * auto-run-selection-parallel
 *
 * The candidate walk used when a parallel-safety filter is given (task 1552), including the strict
 * overlap wait of a CI wait (task 1568). Split out of auto-run-selection.ts (file-size limit).
 */
import type { ParallelFilter, ParallelRejection, ParallelVerdict } from './parallel/parallel-types';
import type { ScopeOverlapContext, SelectionResult } from './auto-run-selection-types';
import { hasScopeOverlap } from './auto-run-scope-overlap';

/** Run the filter on one candidate; a thrown filter refuses it (safe side). */
async function judgeCandidate(
  filter: ParallelFilter,
  candidate: { id: number; status: string },
): Promise<ParallelVerdict> {
  try {
    return await filter(candidate);
  } catch (err) {
    return { ok: false, reason: 'filter_error', detail: String(err).slice(0, 200) };
  }
}

/**
 * Candidate walk used when a parallel-safety filter is given (task 1552). Lazy
 * on purpose: the filter reads plans and files, so it stops at the first
 * accepted candidate that also clears the open-PR deferral. A refused candidate
 * is never the fallback — that is the whole point of the filter.
 */
export async function pickWithParallelFilter(
  eligible: Array<{ id: number; status: string }>,
  filter: ParallelFilter,
  scopeOverlap?: ScopeOverlapContext,
): Promise<SelectionResult> {
  const rejected: ParallelRejection[] = [];
  const deferred: number[] = [];
  let fallback: number | null = null;
  const withLog = <T extends object>(r: T) => (rejected.length > 0 ? { ...r, rejected } : r);
  for (const candidate of eligible) {
    const verdict = await judgeCandidate(filter, candidate);
    if (!verdict.ok) {
      rejected.push({ taskId: candidate.id, reason: verdict.reason, detail: verdict.detail });
      continue;
    }
    if (scopeOverlap && scopeOverlap.openPrFiles.length > 0 && candidate.status !== 'in-progress') {
      const planFiles = await scopeOverlap.getPlanFiles(candidate.id).catch(() => []);
      if (planFiles.length > 0 && hasScopeOverlap(planFiles, scopeOverlap.openPrFiles)) {
        fallback ??= candidate.id;
        deferred.push(candidate.id);
        continue;
      }
    }
    const hit = { found: true as const, taskId: candidate.id };
    return withLog(deferred.length > 0 ? { ...hit, deferred } : hit);
  }
  if (fallback !== null) {
    if (scopeOverlap?.strict) {
      return withLog({ found: false as const, reason: 'all_overlap_deferred' as const, deferred });
    }
    return withLog({ found: true as const, taskId: fallback });
  }
  return { found: false, reason: 'parallel_conflict', rejected };
}
