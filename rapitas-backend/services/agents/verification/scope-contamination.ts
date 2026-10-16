/**
 * scope-contamination
 *
 * Pure classifier deciding whether out-of-plan (offending) files in a task's
 * diff came from BRANCH HISTORY (commits predating this task's session — the
 * task-539 pattern where a worktree was cut on top of another task's branch)
 * or from the implementer's own in-session edits. History contamination cannot
 * be fixed by editing the working tree, so callers route it to worktree-rebuild
 * recovery instead of an implementer bounce. No git/DB I/O — callers supply
 * the touching-commit evidence.
 */

/** One commit that touched an offending file within merge-base..HEAD. */
export interface FileTouchingCommit {
  /** Repo-relative path the commit touched. / コミットが触れたパス */
  file: string;
  /** Commit SHA. / コミットSHA */
  sha: string;
  /** ISO 8601. git の %cI (committer date, strict ISO) を渡す想定。 */
  committedAt: string;
}

export interface ContaminationClassification {
  /** True when at least one offending file is history-contaminated. */
  historyContaminated: boolean;
  /** Offending files attributable to pre-session / unknown-session commits. */
  contaminatedFiles: string[];
  /** offendingFiles のうち historyContaminated と判定されなかったもの */
  inSessionFiles: string[];
}

/**
 * Classify offending files as history-contaminated vs in-session.
 *
 * A file is contaminated when ANY commit touching it (a) predates the session
 * start, or (b) is absent from a non-empty known-session-commit list. A file
 * with NO touching commits (uncommitted working-tree edits only) is treated as
 * in-session — fail-safe: when unsure, prefer the ordinary implementer bounce
 * over triggering a worktree rebuild (research.md risk assessment).
 *
 * @param params.offendingFiles - Out-of-plan changed files / 計画外変更ファイル
 * @param params.touchingCommits - Commits touching those files in merge-base..HEAD / 該当ファイルを触ったコミット
 * @param params.sessionStartedAt - ISO timestamp of this task's session start / セッション開始時刻
 * @param params.sessionCommitShas - Known SHAs made by this session (currently always empty — no positive record source exists yet) / セッション自身のコミットSHA
 * @returns Classification of each offending file / 分類結果
 */
export function classifyScopeContamination(params: {
  offendingFiles: string[];
  touchingCommits: FileTouchingCommit[];
  sessionStartedAt: string;
  sessionCommitShas?: string[];
}): ContaminationClassification {
  const { offendingFiles, touchingCommits, sessionStartedAt } = params;
  const sessionCommitShas = params.sessionCommitShas ?? [];
  const sessionStartMs = Date.parse(sessionStartedAt);
  const knownSessionShas = new Set(sessionCommitShas);

  const contaminatedFiles: string[] = [];
  const inSessionFiles: string[] = [];

  for (const file of offendingFiles) {
    const touching = touchingCommits.filter((c) => c.file === file);
    if (touching.length === 0) {
      // Uncommitted change only — the implementer's own doing.
      inSessionFiles.push(file);
      continue;
    }
    const contaminated = touching.some((c) => {
      const committedMs = Date.parse(c.committedAt);
      // Unparseable timestamps fail-safe to "not before session start".
      const preSession =
        Number.isFinite(committedMs) && Number.isFinite(sessionStartMs)
          ? committedMs < sessionStartMs
          : false;
      const unknownToSession = knownSessionShas.size > 0 && !knownSessionShas.has(c.sha);
      return preSession || unknownToSession;
    });
    if (contaminated) contaminatedFiles.push(file);
    else inSessionFiles.push(file);
  }

  return {
    historyContaminated: contaminatedFiles.length > 0,
    contaminatedFiles,
    inSessionFiles,
  };
}
