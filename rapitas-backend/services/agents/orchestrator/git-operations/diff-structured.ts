/**
 * GitOperations — Structured Diff
 *
 * Provides a per-file structured diff format including addition/deletion counts
 * and patch text for each changed file.
 * Not responsible for committing, branching, or worktree management.
 */

import { exec } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { createLogger } from '../../../../config/logger';

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
 * the stray `.wf-tmp.md`. Tries the repo's base branches in the same order as
 * worktree creation (develop → main → master).
 *
 * @param cwd - Worktree directory / ワークツリーのディレクトリ
 * @returns Merge-base commit hash, or null when no base branch exists / マージベース、無ければnull
 */
async function resolveBaseRef(cwd: string): Promise<string | null> {
  for (const candidate of ['develop', 'main', 'master']) {
    try {
      const { stdout } = await execAsync(`git merge-base HEAD ${candidate}`, {
        cwd,
        encoding: 'utf8',
      });
      const base = stdout.trim();
      if (base) return base;
    } catch {
      // candidate branch doesn't exist in this repo — try the next one.
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
 * @returns Array of file change records / ファイル変更レコードの配列
 */
export async function getDiff(
  workingDirectory: string,
  pathExists: (p: string) => boolean = existsSync,
): Promise<FileDiffRecord[]> {
  if (!workingDirectory || !pathExists(workingDirectory)) {
    logger.warn({ workingDirectory }, 'Working directory does not exist — skipping diff');
    return [];
  }

  const files: FileDiffRecord[] = [];

  try {
    const baseRef = await resolveBaseRef(workingDirectory);

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
    untracked
      .split('\n')
      .filter(Boolean)
      .forEach((filename) => {
        if (!fileMap.has(filename)) {
          fileMap.set(filename, { additions: 0, deletions: 0, status: 'added' });
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
    // `git diff` yields nothing (it's not tracked yet), so the patch stays empty
    // — same as before; committed additions now get their patch too.
    const diffRef = baseRef || 'HEAD';
    for (const [filename, info] of fileMap) {
      let patch = '';
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

      files.push({
        filename,
        status: info.status,
        additions: info.additions,
        deletions: info.deletions,
        patch: patch || undefined,
      });
    }

    return files;
  } catch (error) {
    logger.error({ err: error }, 'Failed to get diff');
    return [];
  }
}
