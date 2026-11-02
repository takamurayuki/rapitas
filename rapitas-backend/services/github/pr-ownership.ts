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
  /** PR head branch — what proves a bare `[#N]` names task N. / PRのheadブランチ */
  headBranch?: string | null;
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
const TASK_MARKER_RE = /\[(Task-|#)(\d+)\]/g;

/**
 * Whether a head branch is task `id`'s own server-generated branch
 * (`feature/t1160-update-logging`, `t1160-…`).
 *
 * @param headBranch - PR head branch / PRのheadブランチ
 * @param id - Task id / タスクID
 * @returns true when a path segment starts with `t{id}-` / t{id}- で始まる区間があるか
 */
export function isTaskBranch(headBranch: string | null | undefined, id: number): boolean {
  return !!headBranch && new RegExp(`(^|/)t${id}-`).test(headBranch);
}

/**
 * Extract the task id from the first trustworthy task marker in a PR title or body.
 *
 * `[Task-{id}]` is only ever written by the server, so it always counts.
 * `[#{id}]` is ambiguous (#1215): CLAUDE.md has sessions title PRs `[#<issue>]`,
 * and issue numbers overlap task ids, so a bare `[#N]` could bind an issue PR to
 * an unrelated task N and auto-merge it. It counts only when the PR's head
 * branch is task N's own (`t{N}-`): 14 of 197 `[#N]` PRs on develop, all
 * genuinely agent-made; the other 183 named issues.
 *
 * @param text - Title or body text to scan / 走査対象のタイトルまたは本文
 * @param headBranch - PR head branch, when known / PRのheadブランチ（判明していれば）
 * @returns The task id, or null when no trustworthy marker is present / 信頼できるマーカーのタスクID、無ければnull
 */
export function extractTaskMarkerId(
  text: string | null | undefined,
  headBranch?: string | null,
): number | null {
  if (!text) return null;
  for (const m of text.matchAll(TASK_MARKER_RE)) {
    const id = parseInt(m[2], 10);
    if (m[1] === 'Task-' || isTaskBranch(headBranch, id)) return id;
  }
  return null;
}

/**
 * Whether two PR titles carry the SAME task marker. A missing marker on either
 * side is a mismatch — a title that proves nothing must never justify reuse.
 *
 * @param oursTitle - The title this task is creating its PR with / 自タスクが使うPRタイトル
 * @param candidateTitle - Title of the existing PR found by branch name / ブランチ名一致で見つかった既存PRのタイトル
 * @param headBranch - The head branch both PRs share / 両PRが共有するheadブランチ
 * @returns true only when both markers exist and name the same task / 両者のマーカーが同一タスクを指す時のみtrue
 */
export function titleMarkersAgree(
  oursTitle: string | null | undefined,
  candidateTitle: string | null | undefined,
  headBranch?: string | null,
): boolean {
  const ours = extractTaskMarkerId(oursTitle, headBranch);
  const theirs = extractTaskMarkerId(candidateTitle, headBranch);
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
  const titleId = extractTaskMarkerId(pr.title, pr.headBranch);
  if (titleId != null) {
    return titleId === taskId
      ? { canClaim: true, reason: 'title_marker_match' }
      : { canClaim: false, reason: 'title_marker_mismatch' };
  }
  const bodyId = extractTaskMarkerId(pr.body, pr.headBranch);
  if (bodyId != null) {
    return bodyId === taskId
      ? { canClaim: true, reason: 'body_marker_match' }
      : { canClaim: false, reason: 'body_marker_mismatch' };
  }
  return { canClaim: false, reason: 'no_marker' };
}
