/**
 * GitOperations — Structured Diff
 *
 * Provides a per-file structured diff format including addition/deletion counts
 * and patch text for each changed file.
 * Not responsible for committing, branching, or worktree management.
 */

import { exec } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { createLogger } from '../../../../config/logger';
import { assertSafeGitRef } from '../../../../utils/common/branch-name-generator';

const execAsync = promisify(exec);
const logger = createLogger('git-operations/diff-structured');

/** A single file's change record from getDiff. */
export type FileDiffRecord = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
};

/**
 * Resolve the commit the worktree branch forked from, so the diff can reflect
 * ALL changes the branch introduced (committed + uncommitted) rather than only
 * the uncommitted working-tree changes. The agent commits its work mid-run
 * (workflow verify phase / post-exec pipeline); after that a working-tree-only
 * diff is empty and the real source files vanish from the review, leaving just
 * the stray `.wf-tmp.md`.
 *
 * Tries `preferredBaseBranch` FIRST — the branch the worktree was actually cut
 * from (`task.theme.defaultBranch`, see task-resolver.ts's
 * `resolvePreferredBaseBranch`) — before falling back to the develop → main →
 * master guess. The guess-only order previously caused false "scope creep"
 * verdicts: if a repo has a stale/divergent `develop` branch while the task
 * branch was really cut from `main`, merge-base against `develop` lands on an
 * ancient common ancestor and the diff then includes every commit merged into
 * `main` since — unrelated features that have nothing to do with this task
 * (task 506).
 *
 * The guess-only fallback tries `origin/<branch>` before the bare local
 * branch name (task 511: the bare local `develop` in a worktree's shared
 * `.git` only advances via unrelated event paths — e.g. post-merge sync — and
 * can sit stale for days, while `origin/<branch>` is refreshed by any fetch
 * anywhere against the same remote).
 *
 * @param cwd - Worktree directory / ワークツリーのディレクトリ
 * @param preferredBaseBranch - The branch this task's worktree was cut from, when known / このタスクの分岐元ブランチ（既知の場合）
 * @returns Merge-base commit hash, or null when no base branch exists / マージベース、無ければnull
 */
async function resolveBaseRef(
  cwd: string,
  preferredBaseBranch?: string | null,
): Promise<string | null> {
  // preferredBaseBranch is persisted DB data (theme.defaultBranch /
  // AgentExecutionConfig.targetBranch), not necessarily re-validated at read
  // time — re-check before it reaches a shell-interpolated git command
  // (defense-in-depth; the write path already runs assertSafeGitRef, but this
  // function must not trust that blindly).
  let safePreferred: string | null = null;
  if (preferredBaseBranch) {
    try {
      assertSafeGitRef(preferredBaseBranch, 'preferredBaseBranch');
      safePreferred = preferredBaseBranch;
    } catch {
      // Unsafe/malformed value — ignore it and fall through to the heuristic.
    }
  }
  // Per branch NAME, try origin/<name> AND local <name>, then keep the NEWER
  // of the two merge-bases — that is the true fork point. Preferring origin
  // unconditionally (the task-511 fix for a stale local branch) breaks the
  // mirrored case: a local-first repo accumulates UNPUSHED commits on the base
  // branch, merge-base against origin lands BEFORE them, and every unpushed
  // commit bleeds into "this task's diff" (observed as "36/37 files are
  // unrelated" adversarial-review rejections). Mirrors automated-verifier.ts's
  // diffBaseRef.
  const groups = [
    ...(safePreferred ? [[`origin/${safePreferred}`, safePreferred]] : []),
    ['origin/develop', 'develop'],
    ['origin/main', 'main'],
    ['origin/master', 'master'],
  ];
  for (const group of groups) {
    const bases: string[] = [];
    for (const candidate of group) {
      try {
        const { stdout } = await execAsync(`git merge-base HEAD ${candidate}`, {
          cwd,
          encoding: 'utf8',
        });
        const base = stdout.trim();
        if (base && !bases.includes(base)) bases.push(base);
      } catch {
        // candidate branch doesn't exist in this repo — try the next one.
      }
    }
    if (bases.length === 1) return bases[0]!;
    if (bases.length === 2) {
      // Exit 0 = bases[0] is an ancestor of bases[1] → bases[1] is newer.
      // On divergence (neither is an ancestor) keep origin's base (task 511).
      try {
        await execAsync(`git merge-base --is-ancestor ${bases[0]} ${bases[1]}`, {
          cwd,
          encoding: 'utf8',
        });
        return bases[1]!;
      } catch {
        return bases[0]!;
      }
    }
  }
  return null;
}

/**
 * Get diff in a structured per-file format with addition/deletion counts and patch text.
 * Combines staged, unstaged, and untracked files into a unified result.
 *
 * @param workingDirectory - Directory to diff / diffを取得するディレクトリ
 * @param pathExists - Predicate to check directory existence; injected in tests to avoid real fs / テストで実fsを回避するための存在チェック関数
 * @param preferredBaseBranch - The branch this task's worktree was actually cut from, when known (e.g. `AgentExecutionConfig.targetBranch`); tried before the develop/main/master guess / このタスクの実際の分岐元ブランチ（既知の場合、推測より優先）
 * @returns Array of file change records / ファイル変更レコードの配列
 */
export async function getDiff(
  workingDirectory: string,
  pathExists: (p: string) => boolean = existsSync,
  preferredBaseBranch?: string | null,
): Promise<FileDiffRecord[]> {
  if (!workingDirectory || !pathExists(workingDirectory)) {
    logger.warn({ workingDirectory }, 'Working directory does not exist — skipping diff');
    return [];
  }

  const files: FileDiffRecord[] = [];

  try {
    const baseRef = await resolveBaseRef(workingDirectory, preferredBaseBranch);

    const fileMap = new Map<string, { additions: number; deletions: number; status: string }>();

    const parseNumstat = (numstat: string) => {
      numstat
        .split('\n')
        .filter(Boolean)
        .forEach((line) => {
          const parts = line.split('\t');
          if (parts.length >= 3) {
            const additions = parseInt(parts[0]!, 10) || 0;
            const deletions = parseInt(parts[1]!, 10) || 0;
            const filename = parts[2]!;
            const existing = fileMap.get(filename);
            fileMap.set(filename, {
              additions: (existing?.additions || 0) + additions,
              deletions: (existing?.deletions || 0) + deletions,
              status: existing?.status || 'modified',
            });
          }
        });
    };

    if (baseRef) {
      // `git diff <base>` compares the fork-point commit to the WORKING TREE, so
      // it captures the agent's committed changes AND any uncommitted work in one
      // pass — this is what makes the real source files appear even after the
      // agent has committed mid-run.
      const { stdout: numstat } = await execAsync(`git diff ${baseRef} --numstat`, {
        cwd: workingDirectory,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      const { stdout: nameStatus } = await execAsync(`git diff ${baseRef} --name-status`, {
        cwd: workingDirectory,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      parseNumstat(numstat);
      nameStatus
        .split('\n')
        .filter(Boolean)
        .forEach((line) => {
          const parts = line.split('\t');
          const code = parts[0]?.charAt(0) ?? 'M';
          // Renames/copies (R###/C###) put the new path in the last column.
          const filename = (parts.length >= 3 ? parts[parts.length - 1] : parts[1]) || '';
          if (!filename) return;
          let fileStatus = 'modified';
          if (code === 'A') fileStatus = 'added';
          else if (code === 'D') fileStatus = 'deleted';
          else if (code === 'R') fileStatus = 'renamed';
          const existing = fileMap.get(filename);
          if (existing) existing.status = fileStatus;
          else fileMap.set(filename, { additions: 0, deletions: 0, status: fileStatus });
        });
    } else {
      // No known base branch (e.g. a detached repo) — fall back to the
      // working-tree-only diff (staged + unstaged).
      const { stdout: stagedNumstat } = await execAsync('git diff --cached --numstat', {
        cwd: workingDirectory,
        encoding: 'utf8',
      });
      const { stdout: unstagedNumstat } = await execAsync('git diff --numstat', {
        cwd: workingDirectory,
        encoding: 'utf8',
      });
      const { stdout: status } = await execAsync('git status --porcelain', {
        cwd: workingDirectory,
        encoding: 'utf8',
      });
      parseNumstat(stagedNumstat);
      parseNumstat(unstagedNumstat);
      status
        .split('\n')
        .filter(Boolean)
        .forEach((line) => {
          const statusCode = line.substring(0, 2);
          const filename = line.substring(3);
          const existing = fileMap.get(filename);
          let fileStatus = 'modified';
          if (statusCode.includes('A') || statusCode.includes('?')) {
            fileStatus = 'added';
          } else if (statusCode.includes('D')) {
            fileStatus = 'deleted';
          } else if (statusCode.includes('R')) {
            fileStatus = 'renamed';
          }
          if (existing) {
            existing.status = fileStatus;
          } else {
            fileMap.set(filename, { additions: 0, deletions: 0, status: fileStatus });
          }
        });
    }

    // Untracked new files are never part of `git diff` — collect them separately.
    // ls-files respects .gitignore / git exclude, so `.wf-tmp*` stays out here.
    const { stdout: untracked } = await execAsync('git ls-files --others --exclude-standard', {
      cwd: workingDirectory,
      encoding: 'utf8',
    });
    const untrackedFiles = new Set<string>();
    untracked
      .split('\n')
      .filter(Boolean)
      .forEach((filename) => {
        if (!fileMap.has(filename)) {
          fileMap.set(filename, { additions: 0, deletions: 0, status: 'added' });
          untrackedFiles.add(filename);
        }
      });

    // Defensively drop the agent's transient `.wf-*` files (`.wf-tmp.md`,
    // `.wf-concern.json`, …). They're added to the worktree git exclude (see
    // worktree-ops.ts), but if that exclude failed or wasn't applied in time the
    // file would otherwise surface as the ONLY "changed file" in the diff —
    // misleading the user into thinking the run produced nothing but a temp file.
    const isTransient = (name: string) => /(^|[\\/])\.wf-/.test(name);
    for (const key of [...fileMap.keys()]) {
      if (isTransient(key)) fileMap.delete(key);
    }

    // Patch against the same ref used for the file list. For an untracked file
    // `git diff <ref> -- <file>` yields nothing (it's not tracked yet, so git
    // has no base to compare against) — additions/deletions stayed hardcoded at
    // 0 and the patch stayed empty, making a genuinely large new file look
    // completely empty ("+0/-0") to the verifier and adversarial diff-review.
    // This blocked real, substantial work (task 504: internal/correlate,
    // change_points.go, cmd/event — all real, non-empty files reported as
    // "+0/-0, tabula rasa" by the reviewer) purely because the implementer
    // never ran `git add` before verify.md. Read the file directly and
    // synthesize a standard "new file" unified-diff patch instead.
    const diffRef = baseRef || 'HEAD';
    for (const [filename, info] of fileMap) {
      let patch = '';
      if (untrackedFiles.has(filename)) {
        try {
          const raw = await readFile(join(workingDirectory, filename), 'utf8');
          const lines = raw.length === 0 ? [] : raw.split('\n');
          // A trailing newline produces one empty trailing element from split —
          // that's the file's final line terminator, not an extra line of content.
          const lineCount = raw.endsWith('\n') ? lines.length - 1 : lines.length;
          info.additions = lineCount;
          info.deletions = 0;
          patch = [
            `diff --git a/${filename} b/${filename}`,
            'new file mode 100644',
            '--- /dev/null',
            `+++ b/${filename}`,
            `@@ -0,0 +1,${lineCount} @@`,
            ...lines.slice(0, raw.endsWith('\n') ? -1 : undefined).map((l) => `+${l}`),
          ].join('\n');
        } catch {
          // Binary file, permission error, or already-deleted — leave the
          // additions/deletions/patch at their pre-existing (zero) values
          // rather than fail the whole diff.
        }
      } else {
        try {
          const { stdout: filePatch } = await execAsync(`git diff ${diffRef} -- "${filename}"`, {
            cwd: workingDirectory,
            encoding: 'utf8',
            maxBuffer: 5 * 1024 * 1024,
          });
          patch = filePatch;
        } catch {
          // intentionally ignore - proceed with empty patch if diff fails
        }
      }

      files.push({
        filename,
        status: info.status,
        additions: info.additions,
        deletions: info.deletions,
        patch: patch || undefined,
      });
    }

    // NOTE (determinism): fileMap's iteration order follows raw `git diff`
    // output order, which is not guaranteed stable (rename detection, index
    // state, git version can all reorder it). The verifier and adversarial
    // diff-review read this list as part of the agent-visible context, so
    // sort by filename to make it reproducible run-to-run regardless of git's
    // internal ordering.
    // filenames are unique within a single diff, so the localeCompare sort has
    // no ties to resolve — it is fully deterministic.
    // determinism-ok: unique filenames per diff, no ties.
    files.sort((a, b) => a.filename.localeCompare(b.filename));

    return files;
  } catch (error) {
    logger.error({ err: error }, 'Failed to get diff');
    return [];
  }
}
