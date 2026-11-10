/**
 * Workflow Auto Commit — Publish binding
 *
 * Ties a publication to the exact worktree + verify.md + diff a human override
 * was given for (review hold). One resolver picks the worktree the same way
 * commit/PR does, and one check is run by the commit side itself, right before
 * and right after it records the commit, so nothing changed after the human
 * looked can be published. Not responsible for the hold or for git itself.
 *
 * NOTE: Dependencies are imported lazily so modules that mock this file's
 * neighbours (workflow-auto-commit tests) do not pull in the DB or git stack.
 */

/** The verify.md version + diff (and the worktree it was read in) an override covers. */
export interface PublishBinding {
  verifySha256: string;
  diffFingerprint: string;
  /** Worktree the fingerprint was taken from — publication must run in it. */
  worktreePath: string;
}

/**
 * Worktree that commit/PR would publish from: the task's most recently ACTIVE
 * session, exactly as performAutoCommitAndPR selects it (lastActivityAt desc).
 * Null when that session has no worktree (publication would fall back to the
 * theme directory, which is not what was reviewed) or the lookup fails.
 *
 * @param taskId - Task id / タスクID
 * @returns Worktree path or null / worktree のパス（無ければ null）
 */
export async function resolvePublishWorktree(taskId: number): Promise<string | null> {
  const { prisma } = await import('../../config/database');
  const session = await prisma.agentSession
    .findFirst({
      where: { config: { taskId } },
      orderBy: { lastActivityAt: 'desc' },
      select: { worktreePath: true },
    })
    .catch(() => null);
  return session?.worktreePath ?? null;
}

/**
 * Why the current state no longer matches the binding, or null when it does.
 * Unreadable identifiers count as a mismatch — an override cannot be proven to
 * cover what we cannot identify. Never throws.
 *
 * @param taskId - Task id / タスクID
 * @param gitCwd - Directory publication actually runs git in / 実際に git を実行するディレクトリ
 * @param b - The binding the override was given for / 上書きの対象
 * @returns Mismatch reason, or null when it still matches / 不一致の理由（一致なら null）
 */
export async function publishBindingDrift(
  taskId: number,
  gitCwd: string,
  b: PublishBinding,
): Promise<string | null> {
  if (gitCwd !== b.worktreePath) return '公開に使う worktree が上書きの対象と異なります';
  const [{ readVerifySha256 }, { currentDiffFingerprint }] = await Promise.all([
    import('../../services/workflow/verify-jury-completion'),
    import('../../services/agents/verification/review-diff-fingerprint'),
  ]);
  const [sha, fp] = await Promise.all([
    readVerifySha256(taskId).catch(() => null),
    currentDiffFingerprint(taskId, gitCwd).catch(() => null),
  ]);
  if (!sha) return 'verify.md の識別子（sha256）を取得できません';
  if (!fp) return '差分の識別子（fingerprint）を取得できません';
  if (sha !== b.verifySha256) return '上書きした後に verify.md が変わりました';
  if (fp !== b.diffFingerprint) return '上書きした後に差分が変わりました';
  return null;
}
