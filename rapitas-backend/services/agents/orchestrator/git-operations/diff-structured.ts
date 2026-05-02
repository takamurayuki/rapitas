/**
 * GitOperations — Structured Diff
 *
 * Provides a per-file structured diff format including addition/deletion counts
 * and patch text for each changed file.
 * Not responsible for committing, branching, or worktree management.
 */

import { exec } from 'child_process';
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
 * Get diff in a structured per-file format with addition/deletion counts and patch text.
 * Combines staged, unstaged, and untracked files into a unified result.
 *
 * @param workingDirectory - Directory to diff / diffを取得するディレクトリ
 * @returns Array of file change records / ファイル変更レコードの配列
 */
export async function getDiff(workingDirectory: string): Promise<FileDiffRecord[]> {
  const files: FileDiffRecord[] = [];

  try {
    const { stdout: stagedNumstat } = await execAsync('git diff --cached --numstat', {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

    const { stdout: unstagedNumstat } = await execAsync('git diff --numstat', {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

    const { stdout: untracked } = await execAsync('git ls-files --others --exclude-standard', {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

    const { stdout: status } = await execAsync('git status --porcelain', {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

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

    parseNumstat(stagedNumstat);
    parseNumstat(unstagedNumstat);

    untracked
      .split('\n')
      .filter(Boolean)
      .forEach((filename) => {
        if (!fileMap.has(filename)) {
          fileMap.set(filename, { additions: 0, deletions: 0, status: 'added' });
        }
      });

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

    for (const [filename, info] of fileMap) {
      let patch = '';
      try {
        if (info.status !== 'added') {
          const { stdout: filePatch } = await execAsync(`git diff HEAD -- "${filename}"`, {
            cwd: workingDirectory,
            encoding: 'utf8',
            maxBuffer: 5 * 1024 * 1024,
          });
          patch = filePatch;
        }
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
