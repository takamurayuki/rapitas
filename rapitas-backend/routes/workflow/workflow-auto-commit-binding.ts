/**
 * Workflow Auto Commit — Publish binding
 *
 * Ties a publication to the exact worktree + verify.md + diff a human override
 * was given for (review hold). One resolver picks the worktree the same way
 * commit/PR does, and one check is run by the commit side itself, right before
 * and right after it records the commit, so nothing changed after the human
 * looked can be published. Not responsible for the hold or for git itself.
 *
 * The post-commit check cannot reuse the raw fingerprint: getDiff synthesizes
 * an UNTRACKED new file's patch (no `index` line), while the committed file
 * comes from `git diff`, so every commit that adds a file would look changed.
 * It compares a commit-stable identity taken from the same pre-commit read.
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

type DiffEntry = { filename: string; status: string; patch?: string | null };

/** The diff's identity with each new file reduced to its added lines (stable across the commit). */
function commitStableFingerprint(
  files: ReadonlyArray<DiffEntry>,
  fp: (f: DiffEntry[]) => string | null,
): string | null {
  return fp(
    files.map((f) =>
      f.status === 'added'
        ? {
            ...f,
            // A new file is defined by its content alone; drop git's headers.
            patch: (f.patch ?? '')
              .split('\n')
              .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
              .join('\n'),
          }
        : f,
    ),
  );
}

/** Raw + commit-stable fingerprints from ONE diff read, or null when unreadable. */
async function readDiffIdentity(
  taskId: number,
  gitCwd: string,
): Promise<{ raw: string | null; stable: string | null } | null> {
  try {
    // NOTE: Mirrors currentDiffFingerprint (same base, same getDiff, same hash)
    // so `raw` equals what the jury and the override recorded.
    const [{ getDiff }, { resolvePreferredBaseBranch }, { fingerprintDiff }] = await Promise.all([
      import('../../services/agents/orchestrator/git-operations/core/diff-structured'),
      import('../../services/task/task-resolver'),
      import('../../services/agents/verification/review-diff-fingerprint'),
    ]);
    const base = await resolvePreferredBaseBranch(taskId);
    const files = await getDiff(gitCwd, undefined, base ?? undefined);
    return { raw: fingerprintDiff(files), stable: commitStableFingerprint(files, fingerprintDiff) };
  } catch {
    return null;
  }
}

/**
 * Pre-commit check run by the committing side: worktree, verify.md and diff
 * must match the binding. On a match, returns the commit-stable identity the
 * post-commit check compares against (both taken from one diff read).
 *
 * @param taskId - Task id / タスクID
 * @param gitCwd - Directory the commit runs in / コミットを実行するディレクトリ
 * @param b - The binding the override was given for / 上書きの対象
 * @returns The mismatch reason, or the identity to re-check after committing / 不一致の理由、またはコミット後の照合値
 */
export async function checkBindingBeforeCommit(
  taskId: number,
  gitCwd: string,
  b: PublishBinding,
): Promise<{ drift: string; stable?: undefined } | { drift: null; stable: string }> {
  if (gitCwd !== b.worktreePath) return { drift: '公開に使う worktree が上書きの対象と異なります' };
  const { readVerifySha256 } = await import('../../services/workflow/verify-jury-completion');
  const [sha, id] = await Promise.all([
    readVerifySha256(taskId).catch(() => null),
    readDiffIdentity(taskId, gitCwd),
  ]);
  if (!sha) return { drift: 'verify.md の識別子（sha256）を取得できません' };
  if (!id?.raw || !id.stable) return { drift: '差分の識別子（fingerprint）を取得できません' };
  if (sha !== b.verifySha256) return { drift: '上書きした後に verify.md が変わりました' };
  if (id.raw !== b.diffFingerprint) return { drift: '上書きした後に差分が変わりました' };
  return { drift: null, stable: id.stable };
}

/**
 * Post-commit check: the tree just committed must still be the one checked
 * before the commit (a change made while it was recorded is in the commit).
 *
 * @param taskId - Task id / タスクID
 * @param gitCwd - Directory the commit ran in / コミットしたディレクトリ
 * @param stable - Identity returned by checkBindingBeforeCommit / コミット前の照合値
 * @returns Mismatch reason, or null when unchanged / 不一致の理由（一致なら null）
 */
export async function bindingDriftAfterCommit(
  taskId: number,
  gitCwd: string,
  stable: string,
): Promise<string | null> {
  const id = await readDiffIdentity(taskId, gitCwd);
  if (!id?.stable) return '差分の識別子（fingerprint）を取得できません';
  return id.stable === stable ? null : '上書きした後に差分が変わりました';
}
