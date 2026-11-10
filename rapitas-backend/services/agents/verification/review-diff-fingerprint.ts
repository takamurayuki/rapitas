/**
 * review-diff-fingerprint
 *
 * A stable identity for "the diff a task's worktree shows against its base",
 * shared by the jury (what it reviewed), the verifier context (what was
 * measured) and the epilogue's fallback gate (what it is about to commit).
 * Not responsible for computing verdicts or storing anything.
 *
 * Why: a review or a measurement is only evidence about the code it actually
 * looked at. Matching by task id or timestamp alone let an older review or
 * measurement stand in for a newer diff (G2 review items 1 and 4).
 */
import { createHash } from 'node:crypto';

/** The fields of a structured diff entry that define the change. */
export interface FingerprintDiffFile {
  filename: string;
  status: string;
  patch?: string | null;
}

/**
 * Hash a structured diff. Order-independent (sorted by filename) so the same
 * change listed in a different order is the same fingerprint.
 *
 * @param files - Structured diff entries / 構造化差分
 * @returns Hex sha256, or null for an empty diff / 差分の指紋（空なら null）
 */
export function fingerprintDiff(files: ReadonlyArray<FingerprintDiffFile>): string | null {
  if (files.length === 0) return null;
  const canonical = [...files]
    .map((f) => [f.filename, f.status, f.patch ?? ''])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Fingerprint of a task worktree's CURRENT diff against the task's preferred
 * base (the same base the jury and the verifier use). Never throws.
 *
 * @param taskId - Task id (selects the base branch) / タスクID
 * @param worktreePath - The task's worktree / worktree のパス
 * @returns Hex sha256, or null when there is no diff or it cannot be read / 指紋（取れなければ null）
 */
export async function currentDiffFingerprint(
  taskId: number,
  worktreePath: string,
): Promise<string | null> {
  try {
    const [{ getDiff }, { resolvePreferredBaseBranch }] = await Promise.all([
      import('../orchestrator/git-operations/core/diff-structured'),
      import('../../task/task-resolver'),
    ]);
    const base = await resolvePreferredBaseBranch(taskId);
    return fingerprintDiff(await getDiff(worktreePath, undefined, base ?? undefined));
  } catch {
    return null;
  }
}
