/**
 * ConflictDetector
 *
 * Real-time file conflict detection for parallel task execution.
 * Polls each tracked worktree's git diff to detect overlapping file modifications.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../config/logger';
import type { AgentCoordinator } from './agent-coordinator';
import type { FileModification, FileConflict, ConflictDetectorConfig } from './safety-types';

const execFileAsync = promisify(execFile);
const logger = createLogger('conflict-detector');

/** Tracked worktree entry for a running task. */
type TrackedWorktree = {
  taskId: number;
  agentId: string;
  worktreePath: string;
};

/**
 * Detects file conflicts across parallel task worktrees in real-time.
 *
 * Polls `git diff --name-status HEAD` in each tracked worktree at a configurable
 * interval and cross-references modifications to find overlapping file edits.
 */
export class ConflictDetector {
  private config: ConflictDetectorConfig;
  private coordinator: AgentCoordinator;

  private trackedWorktrees: Map<number, TrackedWorktree> = new Map();
  private modifications: Map<number, FileModification[]> = new Map();
  private activeConflicts: FileConflict[] = [];
  private pollingTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param coordinator - Agent coordinator for broadcasting conflict messages / 衝突メッセージ配信用コーディネーター
   * @param config - Detection configuration / 検出設定
   */
  constructor(coordinator: AgentCoordinator, config?: Partial<ConflictDetectorConfig>) {
    this.coordinator = coordinator;
    this.config = {
      enabled: config?.enabled ?? true,
      pollingIntervalMs: config?.pollingIntervalMs ?? 10000,
      pauseOnCritical: config?.pauseOnCritical ?? false,
    };

    if (this.config.enabled) {
      this.startPolling();
    }
  }

  /**
   * Register a worktree for conflict tracking after it is created.
   *
   * @param taskId - Task ID owning the worktree / ワークツリーを所有するタスクID
   * @param agentId - Agent ID executing the task / タスクを実行するエージェントID
   * @param worktreePath - Absolute path to the worktree / ワークツリーの絶対パス
   */
  startTracking(taskId: number, agentId: string, worktreePath: string): void {
    this.trackedWorktrees.set(taskId, { taskId, agentId, worktreePath });
    this.modifications.set(taskId, []);
    logger.info(`[ConflictDetector] Tracking started for task ${taskId} at ${worktreePath}`);
  }

  /**
   * Stop tracking a worktree when the task completes or is cancelled.
   *
   * @param taskId - Task ID to stop tracking / 追跡を停止するタスクID
   */
  stopTracking(taskId: number): void {
    this.trackedWorktrees.delete(taskId);
    // NOTE: Keep modifications in memory for post-session analysis
    logger.info(`[ConflictDetector] Tracking stopped for task ${taskId}`);
  }

  /**
   * Return all currently detected file conflicts.
   *
   * @returns Active file conflicts / アクティブなファイル衝突一覧
   */
  getActiveConflicts(): FileConflict[] {
    return [...this.activeConflicts];
  }

  /**
   * Return all recorded file modifications for a specific task.
   *
   * @param taskId - Task ID to query / 照会するタスクID
   * @returns File modifications for the task / タスクのファイル変更一覧
   */
  getTaskModifications(taskId: number): FileModification[] {
    return this.modifications.get(taskId) ?? [];
  }

  /**
   * Stop polling and clear all tracked state.
   */
  cleanup(): void {
    this.stopPolling();
    this.trackedWorktrees.clear();
    this.modifications.clear();
    this.activeConflicts = [];
    logger.info('[ConflictDetector] Cleaned up all tracking state');
  }

  /** Start the periodic polling loop. */
  private startPolling(): void {
    if (this.pollingTimer) return;

    this.pollingTimer = setInterval(() => {
      this.pollAll().catch((err) => {
        logger.error({ err }, '[ConflictDetector] Polling cycle failed');
      });
    }, this.config.pollingIntervalMs);

    logger.info(
      `[ConflictDetector] Polling started (interval: ${this.config.pollingIntervalMs}ms)`,
    );
  }

  /** Stop the polling loop. */
  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
      logger.info('[ConflictDetector] Polling stopped');
    }
  }

  /**
   * Execute a single polling cycle: collect diffs from all worktrees, then
   * cross-reference to detect conflicts.
   */
  private async pollAll(): Promise<void> {
    if (this.trackedWorktrees.size < 2) return;

    const pollPromises = Array.from(this.trackedWorktrees.values()).map((wt) =>
      this.collectModifications(wt),
    );
    await Promise.allSettled(pollPromises);

    this.detectConflicts();
  }

  /**
   * Run `git diff --name-status HEAD` in a worktree and record results.
   *
   * @param wt - Tracked worktree entry / 追跡中のワークツリーエントリ
   */
  private async collectModifications(wt: TrackedWorktree): Promise<void> {
    try {
      const { stdout } = await execFileAsync('git', ['diff', '--name-status', 'HEAD'], {
        cwd: wt.worktreePath,
        timeout: 5000,
      });

      const now = new Date();
      const mods: FileModification[] = [];

      for (const line of stdout.trim().split('\n')) {
        if (!line) continue;
        const [status, filePath] = line.split('\t');
        if (!status || !filePath) continue;

        const changeType = status.charAt(0) as FileModification['changeType'];
        if (!['A', 'M', 'D', 'R'].includes(changeType)) continue;

        mods.push({
          filePath: filePath.replace(/\\/g, '/'),
          taskId: wt.taskId,
          agentId: wt.agentId,
          timestamp: now,
          changeType,
        });
      }

      this.modifications.set(wt.taskId, mods);
    } catch (error) {
      // NOTE: Worktree may have been removed between scheduling and execution — not fatal
      logger.debug(
        { err: error },
        `[ConflictDetector] Failed to collect modifications for task ${wt.taskId}`,
      );
    }
  }

  /**
   * Cross-reference all task modifications to find overlapping files.
   * When conflicts are found, broadcast via the coordinator.
   */
  private detectConflicts(): void {
    const fileToTasks = new Map<string, number[]>();

    for (const [taskId, mods] of this.modifications) {
      // NOTE: Only consider actively tracked tasks to avoid stale data
      if (!this.trackedWorktrees.has(taskId)) continue;

      for (const mod of mods) {
        const existing = fileToTasks.get(mod.filePath) ?? [];
        if (!existing.includes(taskId)) {
          existing.push(taskId);
          fileToTasks.set(mod.filePath, existing);
        }
      }
    }

    const newConflicts: FileConflict[] = [];
    const now = new Date();

    for (const [filePath, taskIds] of fileToTasks) {
      if (taskIds.length < 2) continue;

      const isCritical = this.isHighRiskFile(filePath);
      newConflicts.push({
        filePath,
        involvedTasks: taskIds,
        severity: isCritical ? 'critical' : 'warning',
        detectedAt: now,
      });
    }

    const hadConflicts = this.activeConflicts.length;
    this.activeConflicts = newConflicts;

    // NOTE: Only broadcast when new conflicts appear or severity changes
    if (newConflicts.length > 0 && newConflicts.length !== hadConflicts) {
      this.broadcastConflicts(newConflicts);
    }
  }

  /**
   * Determine if a file path is high-risk for concurrent modification.
   *
   * @param filePath - Relative file path / 相対ファイルパス
   * @returns True if the file is high-risk / 高リスクファイルの場合true
   */
  private isHighRiskFile(filePath: string): boolean {
    const highRiskPatterns = [
      /^index\./,
      /\/index\./,
      /schema\./,
      /package\.json$/,
      /\.lock$/,
      /prisma\/schema\.prisma$/,
      /config\//,
    ];
    return highRiskPatterns.some((p) => p.test(filePath));
  }

  /**
   * Broadcast conflict information to all agents via the coordinator.
   *
   * @param conflicts - Detected conflicts to broadcast / 配信する検出済み衝突
   */
  private broadcastConflicts(conflicts: FileConflict[]): void {
    const criticalCount = conflicts.filter((c) => c.severity === 'critical').length;
    const warningCount = conflicts.length - criticalCount;

    logger.warn(
      `[ConflictDetector] ${conflicts.length} conflict(s) detected (${criticalCount} critical, ${warningCount} warning)`,
    );

    this.coordinator.broadcastMessage({
      id: `conflict-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId: 'system',
      toAgentId: 'broadcast',
      type: 'conflict_detected',
      payload: {
        conflicts,
        criticalCount,
        warningCount,
        message: `File conflicts detected: ${conflicts.map((c) => c.filePath).join(', ')}`,
      },
    });
  }
}
