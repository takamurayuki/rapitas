/**
 * GitOperations — Repository Setup
 *
 * Initializes git repositories and configures remote origins.
 * Follows Git-flow conventions: creates an initial commit and develop branch
 * when initializing a new repository.
 * Not responsible for worktree lifecycle or diff/commit operations.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../../config/logger';

const execAsync = promisify(exec);
const logger = createLogger('git-operations/repository-setup');

/**
 * Ensure a directory is a valid Git repository. Initialize if not.
 * For new repositories, creates initial commit and develop branch following Git-flow.
 * Also sets up remote URL if provided.
 *
 * @param directory - Directory to check / 確認するディレクトリ
 * @param repositoryUrl - Repository URL to set as remote origin / remoteのoriginとして設定するリポジトリURL
 * @returns true if repository exists or was initialized / リポジトリが存在または初期化された場合true
 */
export async function ensureGitRepository(
  directory: string,
  repositoryUrl?: string | null,
): Promise<boolean> {
  try {
    await execAsync('git rev-parse --git-dir', { cwd: directory, encoding: 'utf8' });
    logger.info(`[ensureGitRepository] Git repository already exists at ${directory}`);
    return true;
  } catch {
    logger.info(`[ensureGitRepository] Initializing Git repository at ${directory}`);
    try {
      await execAsync('git init', { cwd: directory, encoding: 'utf8' });
      logger.info(`[ensureGitRepository] Git repository initialized at ${directory}`);

      let hasCommits = false;
      try {
        await execAsync('git rev-parse HEAD', { cwd: directory, encoding: 'utf8' });
        hasCommits = true;
      } catch {
        hasCommits = false;
      }

      if (!hasCommits) {
        logger.info(
          `[ensureGitRepository] New repository detected, creating initial commit and develop branch`,
        );

        const { writeFile } = await import('fs/promises');
        const { join: pathJoin } = await import('path');

        await writeFile(pathJoin(directory, '.gitkeep'), '', 'utf8');
        await execAsync('git add .gitkeep', { cwd: directory, encoding: 'utf8' });
        await execAsync('git commit -m "Initial commit"', { cwd: directory, encoding: 'utf8' });
        logger.info(`[ensureGitRepository] Created initial commit`);

        await execAsync('git branch develop', { cwd: directory, encoding: 'utf8' });
        await execAsync('git checkout develop', { cwd: directory, encoding: 'utf8' });
        logger.info(`[ensureGitRepository] Created and switched to develop branch`);

        if (repositoryUrl) {
          await validateAndSetupRemote(directory, repositoryUrl);
          logger.info(`[ensureGitRepository] Remote configured for new repository`);
        }
      }

      return true;
    } catch (error) {
      logger.error(
        { err: error },
        `[ensureGitRepository] Failed to initialize repository at ${directory}`,
      );
      return false;
    }
  }
}

/**
 * Validate and setup remote for the repository.
 * Ensures the remote 'origin' points to the correct repository URL.
 *
 * @param directory - Repository directory / リポジトリディレクトリ
 * @param repositoryUrl - Expected remote URL / 期待されるリモートURL
 * @returns true if remote is correctly configured / リモートが正しく設定されている場合true
 */
export async function validateAndSetupRemote(
  directory: string,
  repositoryUrl?: string | null,
): Promise<boolean> {
  if (!repositoryUrl) {
    logger.debug(`[validateAndSetupRemote] No repository URL provided, skipping remote setup`);
    return true;
  }

  try {
    const { stdout: currentRemote } = await execAsync('git remote get-url origin', {
      cwd: directory,
      encoding: 'utf8',
    });

    const currentUrl = currentRemote.trim();
    const expectedUrl = repositoryUrl.trim();

    if (currentUrl === expectedUrl) {
      logger.info(`[validateAndSetupRemote] Remote 'origin' is correctly set to ${expectedUrl}`);
      return true;
    }

    logger.warn(
      `[validateAndSetupRemote] Remote URL mismatch! Current: ${currentUrl}, Expected: ${expectedUrl}. Updating...`,
    );
    await execAsync(`git remote set-url origin "${expectedUrl}"`, {
      cwd: directory,
      encoding: 'utf8',
    });
    logger.info(`[validateAndSetupRemote] Updated remote 'origin' to ${expectedUrl}`);
    return true;
  } catch {
    logger.info(`[validateAndSetupRemote] Adding remote 'origin' with URL ${repositoryUrl}`);
    try {
      await execAsync(`git remote add origin "${repositoryUrl}"`, {
        cwd: directory,
        encoding: 'utf8',
      });
      logger.info(`[validateAndSetupRemote] Remote 'origin' added successfully`);
      return true;
    } catch (error) {
      logger.error({ err: error }, `[validateAndSetupRemote] Failed to add remote 'origin'`);
      return false;
    }
  }
}
