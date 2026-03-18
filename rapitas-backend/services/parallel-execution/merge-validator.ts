/**
 * MergeValidator
 *
 * Post-session merge validation and regression risk detection.
 * Creates a temporary worktree to trial-merge all task branches and
 * scans diffs for overlapping patterns that indicate regression risks.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { createLogger } from '../../config/logger';
import type {
  MergeConflictInfo,
  TrialMergeResult,
  RegressionRisk,
  SafetyReport,
  FileConflict,
} from './safety-types';

const execFileAsync = promisify(execFile);
const logger = createLogger('merge-validator');

/** Branch reference for a completed task. */
export type TaskBranch = {
  taskId: number;
  branchName: string;
};

/** Regex patterns used to detect regression risks across branches. */
const RISK_PATTERNS: Array<{
  type: RegressionRisk['type'];
  pattern: RegExp;
  description: string;
}> = [
  {
    type: 'duplicate_function',
    pattern: /export\s+(?:async\s+)?function\s+(\w+)/g,
    description: 'Exported function definition',
  },
  {
    type: 'api_route_conflict',
    pattern: /\.(get|post|put|delete|patch)\(/g,
    description: 'API route registration',
  },
  {
    type: 'type_conflict',
    pattern: /export\s+(?:type|interface)\s+(\w+)/g,
    description: 'Exported type/interface definition',
  },
  {
    type: 'import_conflict',
    pattern: /from\s+['"]\.[\w\-./]*/g,
    description: 'Relative import path',
  },
];

/**
 * Validates merge safety after parallel execution by performing trial merges
 * and scanning for regression risk patterns across task branches.
 */
export class MergeValidator {
  /** Paths of temporary worktrees created by this instance, for cleanup. */
  private trialWorktrees: string[] = [];

  /**
   * Perform a trial merge of all task branches into a temporary worktree.
   *
   * @param baseDir - Repository root directory / リポジトリルートディレクトリ
   * @param taskBranches - Branches to merge / マージ対象のブランチ
   * @param baseBranch - Base branch to merge into / マージ先のベースブランチ
   * @returns Trial merge result with conflict details / 衝突詳細を含むトライアルマージ結果
   */
  async performTrialMerge(
    baseDir: string,
    taskBranches: TaskBranch[],
    baseBranch: string,
  ): Promise<TrialMergeResult> {
    if (taskBranches.length === 0) {
      return { success: true, conflicts: [], mergedBranches: [], failedBranches: [] };
    }

    const worktreePath = path.join(baseDir, `.worktrees`, `trial-merge-${Date.now()}`);
    const result: TrialMergeResult = {
      success: true,
      conflicts: [],
      mergedBranches: [],
      failedBranches: [],
    };

    try {
      await this.createTrialWorktree(baseDir, worktreePath, baseBranch);
      this.trialWorktrees.push(worktreePath);

      for (const branch of taskBranches) {
        const mergeResult = await this.tryMergeBranch(worktreePath, branch);
        if (mergeResult.success) {
          result.mergedBranches.push(branch.branchName);
        } else {
          result.success = false;
          result.failedBranches.push(branch.branchName);
          result.conflicts.push(...mergeResult.conflicts);
        }
      }

      logger.info(
        `[MergeValidator] Trial merge complete: ${result.mergedBranches.length} merged, ${result.failedBranches.length} failed`,
      );
    } catch (error) {
      logger.error({ err: error }, '[MergeValidator] Trial merge setup failed');
      result.success = false;
    } finally {
      await this.removeWorktree(baseDir, worktreePath);
    }

    return result;
  }

  /**
   * Detect regression risks by scanning diffs across all task branches.
   *
   * @param baseDir - Repository root directory / リポジトリルートディレクトリ
   * @param taskBranches - Branches to analyze / 分析対象のブランチ
   * @param baseBranch - Base branch for diff comparison / diff比較用ベースブランチ
   * @returns Detected regression risks / 検出された回帰リスク
   */
  async detectRegressionRisks(
    baseDir: string,
    taskBranches: TaskBranch[],
    baseBranch: string,
  ): Promise<RegressionRisk[]> {
    if (taskBranches.length < 2) return [];

    /** Maps pattern match key → { taskIds, files } */
    const patternHits = new Map<
      string,
      { type: RegressionRisk['type']; match: string; taskIds: Set<number>; files: Set<string> }
    >();

    for (const branch of taskBranches) {
      try {
        const diff = await this.getBranchDiff(baseDir, branch.branchName, baseBranch);
        this.scanDiffForPatterns(diff, branch.taskId, patternHits);
      } catch (error) {
        logger.warn(
          { err: error },
          `[MergeValidator] Failed to get diff for branch ${branch.branchName}`,
        );
      }
    }

    const risks: RegressionRisk[] = [];
    for (const [, hit] of patternHits) {
      // NOTE: Only report when 2+ tasks touch the same pattern — single-task hits are expected
      if (hit.taskIds.size < 2) continue;

      risks.push({
        type: hit.type,
        description: `${hit.match} modified by ${hit.taskIds.size} tasks`,
        files: [...hit.files],
        taskIds: [...hit.taskIds],
        severity: hit.type === 'api_route_conflict' || hit.type === 'type_conflict'
          ? 'critical'
          : 'warning',
      });
    }

    logger.info(`[MergeValidator] Detected ${risks.length} regression risk(s)`);
    return risks;
  }

  /**
   * Generate a complete safety report for a parallel execution session.
   *
   * @param sessionId - Session identifier / セッション識別子
   * @param baseDir - Repository root directory / リポジトリルートディレクトリ
   * @param taskBranches - Completed task branches / 完了したタスクブランチ
   * @param baseBranch - Base branch name / ベースブランチ名
   * @param fileConflicts - Real-time detected conflicts / リアルタイム検出済み衝突
   * @returns Aggregated safety report / 統合安全レポート
   */
  async generateSafetyReport(
    sessionId: string,
    baseDir: string,
    taskBranches: TaskBranch[],
    baseBranch: string,
    fileConflicts: FileConflict[],
  ): Promise<SafetyReport> {
    logger.info(
      `[MergeValidator] Generating safety report for session ${sessionId} (${taskBranches.length} branches)`,
    );

    const [trialMerge, regressionRisks] = await Promise.all([
      this.performTrialMerge(baseDir, taskBranches, baseBranch),
      this.detectRegressionRisks(baseDir, taskBranches, baseBranch),
    ]);

    const recommendation = this.determineRecommendation(trialMerge, regressionRisks, fileConflicts);

    const report: SafetyReport = {
      sessionId,
      generatedAt: new Date(),
      trialMerge,
      regressionRisks,
      fileConflicts,
      recommendation,
    };

    logger.info(
      `[MergeValidator] Safety report generated: recommendation=${recommendation}, ` +
        `mergeSuccess=${trialMerge.success}, risks=${regressionRisks.length}, conflicts=${fileConflicts.length}`,
    );

    return report;
  }

  /**
   * Remove all temporary worktrees created by this validator.
   *
   * @param baseDir - Repository root directory / リポジトリルートディレクトリ
   */
  async cleanup(baseDir: string): Promise<void> {
    for (const wt of this.trialWorktrees) {
      await this.removeWorktree(baseDir, wt);
    }
    this.trialWorktrees = [];
  }

  /**
   * Create a detached worktree for trial merging.
   *
   * @param baseDir - Repository root / リポジトリルート
   * @param worktreePath - Target worktree path / ワークツリーパス
   * @param baseBranch - Branch to base the worktree on / ベースブランチ
   */
  private async createTrialWorktree(
    baseDir: string,
    worktreePath: string,
    baseBranch: string,
  ): Promise<void> {
    const parentDir = path.dirname(worktreePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    await execFileAsync('git', ['worktree', 'add', '--detach', worktreePath, baseBranch], {
      cwd: baseDir,
      timeout: 30000,
    });

    logger.info(`[MergeValidator] Created trial worktree at ${worktreePath}`);
  }

  /**
   * Attempt to merge a single branch into the trial worktree.
   *
   * @param worktreePath - Trial worktree path / トライアルワークツリーパス
   * @param branch - Branch to merge / マージ対象ブランチ
   * @returns Success status and any conflicts / 成功状態と衝突情報
   */
  private async tryMergeBranch(
    worktreePath: string,
    branch: TaskBranch,
  ): Promise<{ success: boolean; conflicts: MergeConflictInfo[] }> {
    try {
      await execFileAsync(
        'git',
        ['merge', '--no-commit', '--no-ff', branch.branchName],
        { cwd: worktreePath, timeout: 30000 },
      );

      // NOTE: Commit the merge so subsequent branches merge cleanly on top
      await execFileAsync(
        'git',
        ['commit', '-m', `Trial merge: ${branch.branchName}`],
        { cwd: worktreePath, timeout: 10000 },
      );

      return { success: true, conflicts: [] };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const conflicts = await this.extractConflictFiles(worktreePath, branch.branchName);

      logger.warn(
        `[MergeValidator] Merge failed for ${branch.branchName}: ${conflicts.length} conflict(s)`,
      );

      // NOTE: Abort the failed merge to leave the worktree in a clean state for next branch
      try {
        await execFileAsync('git', ['merge', '--abort'], {
          cwd: worktreePath,
          timeout: 10000,
        });
      } catch {
        // HACK(agent): merge --abort may fail if merge didn't start — safe to ignore
        logger.debug(`[MergeValidator] merge --abort failed (may not have been in merge state)`);
      }

      return { success: false, conflicts };
    }
  }

  /**
   * Extract conflicting file paths from a failed merge state.
   *
   * @param worktreePath - Worktree in merge-conflict state / マージ衝突状態のワークツリー
   * @param branchName - Branch that caused the conflict / 衝突を起こしたブランチ
   * @returns Conflict information per file / ファイルごとの衝突情報
   */
  private async extractConflictFiles(
    worktreePath: string,
    branchName: string,
  ): Promise<MergeConflictInfo[]> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--name-only', '--diff-filter=U'],
        { cwd: worktreePath, timeout: 10000 },
      );

      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((filePath) => ({
          filePath: filePath.replace(/\\/g, '/'),
          branches: [branchName],
          conflictType: 'content' as const,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Get the diff between a task branch and the base branch.
   *
   * @param baseDir - Repository root / リポジトリルート
   * @param branchName - Task branch / タスクブランチ
   * @param baseBranch - Base branch / ベースブランチ
   * @returns Unified diff output / ユニファイドdiff出力
   */
  private async getBranchDiff(
    baseDir: string,
    branchName: string,
    baseBranch: string,
  ): Promise<string> {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', `${baseBranch}...${branchName}`],
      { cwd: baseDir, timeout: 30000 },
    );
    return stdout;
  }

  /**
   * Scan a diff string for risk patterns and accumulate hits.
   *
   * @param diff - Unified diff text / ユニファイドdiffテキスト
   * @param taskId - Task that produced this diff / このdiffを生成したタスクID
   * @param hits - Accumulator for pattern matches / パターンマッチの蓄積先
   */
  private scanDiffForPatterns(
    diff: string,
    taskId: number,
    hits: Map<
      string,
      { type: RegressionRisk['type']; match: string; taskIds: Set<number>; files: Set<string> }
    >,
  ): void {
    // NOTE: Extract current file path from diff headers for context
    let currentFile = '';
    for (const line of diff.split('\n')) {
      if (line.startsWith('+++ b/')) {
        currentFile = line.slice(6);
        continue;
      }

      // NOTE: Only scan added lines (starting with +) to avoid false positives from removed code
      if (!line.startsWith('+') || line.startsWith('+++')) continue;

      for (const { type, pattern } of RISK_PATTERNS) {
        // NOTE: Reset lastIndex because we reuse the same RegExp across lines
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          const key = `${type}:${match[0]}`;
          const existing = hits.get(key);
          if (existing) {
            existing.taskIds.add(taskId);
            if (currentFile) existing.files.add(currentFile);
          } else {
            hits.set(key, {
              type,
              match: match[0],
              taskIds: new Set([taskId]),
              files: new Set(currentFile ? [currentFile] : []),
            });
          }
        }
      }
    }
  }

  /**
   * Determine the overall recommendation based on merge results and risks.
   *
   * @param trialMerge - Trial merge result / トライアルマージ結果
   * @param risks - Regression risks / 回帰リスク
   * @param conflicts - Real-time conflicts / リアルタイム衝突
   * @returns Recommendation string / 推奨文字列
   */
  private determineRecommendation(
    trialMerge: TrialMergeResult,
    risks: RegressionRisk[],
    conflicts: FileConflict[],
  ): SafetyReport['recommendation'] {
    if (!trialMerge.success || conflicts.some((c) => c.severity === 'critical')) {
      return 'conflicts_detected';
    }

    if (risks.some((r) => r.severity === 'critical') || conflicts.length > 0) {
      return 'review_needed';
    }

    if (risks.length > 0) {
      return 'review_needed';
    }

    return 'safe_to_merge';
  }

  /**
   * Remove a worktree and clean up its directory.
   *
   * @param baseDir - Repository root / リポジトリルート
   * @param worktreePath - Worktree to remove / 削除対象ワークツリー
   */
  private async removeWorktree(baseDir: string, worktreePath: string): Promise<void> {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: baseDir,
        timeout: 15000,
      });
      logger.info(`[MergeValidator] Removed trial worktree at ${worktreePath}`);
    } catch (error) {
      // NOTE: Worktree may already have been cleaned up — not fatal
      logger.debug(
        { err: error },
        `[MergeValidator] Failed to remove worktree at ${worktreePath}`,
      );
    }

    this.trialWorktrees = this.trialWorktrees.filter((wt) => wt !== worktreePath);
  }
}
