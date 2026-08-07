/**
 * PR Ownership Verification
 *
 * Pure task-identity checks used before adopting an existing PR (found by head
 * branch name) as a task's own PR. Not responsible for any DB or GitHub access —
 * intentionally dependency-free so the gh CLI layer (branch-pr-ops.ts) can use
 * it without pulling the Prisma client into its dependency graph.
 */

/** Candidate PR fields available for ownership verification. */
export interface PrOwnershipCandidate {
  /** Task linked in the local DB row, when known. / DB上で紐付いているタスクID */
  linkedTaskId?: number | null;
  /** PR title. / PRタイトル */
  title?: string | null;
  /** PR body. / PR本文 */
  body?: string | null;
}

/** Result of {@link verifyPrOwnership}. */
export interface PrOwnershipVerdict {
  /** Whether the task may claim/link this PR as its own. / このPRを自タスクとして採用してよいか */
  canClaim: boolean;
  /** Machine-readable reason for the verdict. / 判定理由 */
  reason:
    | 'linked_to_self'
    | 'linked_to_other_task'
    | 'title_marker_match'
    | 'title_marker_mismatch'
    | 'body_marker_match'
    | 'body_marker_mismatch'
    | 'no_marker';
}

// NOTE: Duplicates the marker logic of pr-task-resolver.ts::titleMatchesTask on
// purpose — that module lives next to a `config/database` import chain whose
// module load runs `new PrismaClient()` (side effect), which must not leak into
// the DB-free branch-pr-ops.ts test/dependency graph.
const TASK_MARKER_RE = /\[(?:Task-|#)(\d+)\]/;

/**
 * Extract the task id from the first `[Task-{id}]` / `[#{id}]` marker in a PR
 * title or body.
 *
 * @param text - Title or body text to scan / 走査対象のタイトルまたは本文
 * @returns The marker's task id, or null when no marker is present / マーカーのタスクID、無ければnull
 */
export function extractTaskMarkerId(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = TASK_MARKER_RE.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Whether two PR titles carry the SAME task marker. A missing marker on either
 * side is a mismatch — a title that proves nothing must never justify reuse.
 *
 * @param oursTitle - The title this task is creating its PR with / 自タスクが使うPRタイトル
 * @param candidateTitle - Title of the existing PR found by branch name / ブランチ名一致で見つかった既存PRのタイトル
 * @returns true only when both markers exist and name the same task / 両者のマーカーが同一タスクを指す時のみtrue
 */
export function titleMarkersAgree(
  oursTitle: string | null | undefined,
  candidateTitle: string | null | undefined,
): boolean {
  const ours = extractTaskMarkerId(oursTitle);
  const theirs = extractTaskMarkerId(candidateTitle);
  return ours != null && theirs != null && ours === theirs;
}

/**
 * Decide whether a task may claim an existing PR as its own.
 *
 * Precedence: an existing `linkedTaskId` always wins (a PR already linked to
 * another task is NEVER claimable); otherwise the title marker decides, then the
 * body marker. A PR that proves nothing (no link, no marker) is never claimed —
 * safe-side default so a human's hand-made PR is not stolen by branch-name match.
 *
 * @param pr - Candidate PR fields (DB row or gh CLI response) / 候補PRの情報
 * @param taskId - The task attempting to claim the PR / 採用を試みるタスクID
 * @returns Verdict with claimability and reason / 採用可否と理由
 */
export function verifyPrOwnership(pr: PrOwnershipCandidate, taskId: number): PrOwnershipVerdict {
  if (pr.linkedTaskId != null) {
    return pr.linkedTaskId === taskId
      ? { canClaim: true, reason: 'linked_to_self' }
      : { canClaim: false, reason: 'linked_to_other_task' };
  }
  const titleId = extractTaskMarkerId(pr.title);
  if (titleId != null) {
    return titleId === taskId
      ? { canClaim: true, reason: 'title_marker_match' }
      : { canClaim: false, reason: 'title_marker_mismatch' };
  }
  const bodyId = extractTaskMarkerId(pr.body);
  if (bodyId != null) {
    return bodyId === taskId
      ? { canClaim: true, reason: 'body_marker_match' }
      : { canClaim: false, reason: 'body_marker_mismatch' };
  }
  return { canClaim: false, reason: 'no_marker' };
}
