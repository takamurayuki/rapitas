/**
 * 並列実行スケジューラー
 * 依存関係を考慮したタスクの並列スケジューリングを管理
 */

import type {
  TaskNode,
  ParallelExecutionPlan,
  ParallelExecutionSession,
  ParallelExecutionStatus,
  SubAgentState,
  ParallelGroup,
  ResourceConstraint,
  ParallelExecutionConfig,
} from './types';

/**
 * スケジュール済みタスク
 */
type ScheduledTask = {
  taskId: number;
  groupId: number;
  level: number;
  priority: number;
  scheduledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  status: ParallelExecutionStatus;
};

/**
 * スケジューラーイベント
 */
type SchedulerEvent = {
  type: 'task_scheduled' | 'task_started' | 'task_completed' | 'task_failed' | 'level_completed' | 'all_completed';
  taskId?: number;
  level?: number;
  timestamp: Date;
  metadata?: Record<string, unknown>;
};

type SchedulerEventListener = (event: SchedulerEvent) => void;

/**
 * 並列スケジューラークラス
 */
export class ParallelScheduler {
  private plan: ParallelExecutionPlan;
  private config: ParallelExecutionConfig;
  private nodes: Map<number, TaskNode>;

  private scheduledTasks: Map<number, ScheduledTask> = new Map();
  private runningTasks: Set<number> = new Set();
  private completedTasks: Set<number> = new Set();
  private failedTasks: Set<number> = new Set();
  private blockedTasks: Set<number> = new Set();

  private currentLevel: number = 0;
  private eventListeners: Set<SchedulerEventListener> = new Set();

  // リソースロック管理
  private resourceLocks: Map<string, number> = new Map(); // resource -> taskId

  constructor(
    plan: ParallelExecutionPlan,
    nodes: Map<number, TaskNode>,
    config: ParallelExecutionConfig
  ) {
    this.plan = plan;
    this.nodes = nodes;
    this.config = config;
    this.initializeSchedule();
  }

  /**
   * スケジュールを初期化
   */
  private initializeSchedule(): void {
    for (const group of this.plan.groups) {
      for (const taskId of group.taskIds) {
        const node = this.nodes.get(taskId);
        if (node) {
          this.scheduledTasks.set(taskId, {
            taskId,
            groupId: group.groupId,
            level: group.level,
            priority: this.calculatePriority(node),
            scheduledAt: new Date(),
            status: 'scheduled',
          });
        }
      }
    }
  }

  /**
   * タスクの優先度を計算
   */
  private calculatePriority(node: TaskNode): number {
    let priority = 0;

    // クリティカルパス上のタスクは優先度を上げる
    if (this.plan.groups.some(g =>
      g.taskIds.includes(node.id) && g.internalDependencies.length > 0
    )) {
      priority += 50;
    }

    // 優先度設定を反映
    switch (node.priority) {
      case 'urgent': priority += 40; break;
      case 'high': priority += 30; break;
      case 'medium': priority += 20; break;
      case 'low': priority += 10; break;
    }

    // 依存タスクが多いほど優先度を上げる（ブロッカーを早く完了）
    priority += (node.dependents?.length || 0) * 5;

    // 推定時間が長いタスクは優先度を下げる（短いタスクを先に）
    priority -= Math.min(20, node.estimatedHours * 2);

    return priority;
  }

  /**
   * 次に実行可能なタスクを取得
   */
  getNextExecutableTasks(): number[] {
    const executable: { taskId: number; priority: number }[] = [];

    for (const [taskId, scheduled] of this.scheduledTasks) {
      // 既に実行中、完了、または失敗したタスクはスキップ
      if (
        this.runningTasks.has(taskId) ||
        this.completedTasks.has(taskId) ||
        this.failedTasks.has(taskId)
      ) {
        continue;
      }

      // 依存関係をチェック
      if (!this.canExecute(taskId)) {
        this.blockedTasks.add(taskId);
        continue;
      }

      // リソース制約をチェック
      if (!this.checkResourceConstraints(taskId)) {
        continue;
      }

      // 最大同時実行数をチェック
      if (this.runningTasks.size >= this.config.maxConcurrentAgents) {
        break;
      }

      executable.push({ taskId, priority: scheduled.priority });
    }

    // 優先度順にソート
    executable.sort((a, b) => b.priority - a.priority);

    return executable
      .slice(0, this.config.maxConcurrentAgents - this.runningTasks.size)
      .map(e => e.taskId);
  }

  /**
   * タスクが実行可能かチェック
   */
  canExecute(taskId: number): boolean {
    const node = this.nodes.get(taskId);
    if (!node) return false;

    // すべての依存タスクが完了しているかチェック
    for (const depId of node.dependencies) {
      if (!this.completedTasks.has(depId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * リソース制約をチェック
   */
  private checkResourceConstraints(taskId: number): boolean {
    const node = this.nodes.get(taskId);
    if (!node) return false;

    for (const constraint of this.plan.resourceConstraints) {
      if (constraint.affectedTasks.includes(taskId)) {
        // 同じリソースを使用するタスクの実行数をカウント
        const concurrentUsage = Array.from(this.runningTasks).filter(
          runningId => constraint.affectedTasks.includes(runningId)
        ).length;

        if (concurrentUsage >= constraint.maxConcurrent) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * タスクの実行を開始
   */
  startTask(taskId: number): boolean {
    if (!this.canExecute(taskId)) {
      return false;
    }

    const scheduled = this.scheduledTasks.get(taskId);
    if (!scheduled) return false;

    scheduled.status = 'running';
    scheduled.startedAt = new Date();
    this.runningTasks.add(taskId);
    this.blockedTasks.delete(taskId);

    // リソースをロック
    this.acquireResourceLocks(taskId);

    this.emitEvent({
      type: 'task_started',
      taskId,
      level: scheduled.level,
      timestamp: new Date(),
    });

    return true;
  }

  /**
   * リソースロックを取得
   */
  private acquireResourceLocks(taskId: number): void {
    const node = this.nodes.get(taskId);
    if (!node) return;

    for (const file of node.files) {
      this.resourceLocks.set(file, taskId);
    }
  }

  /**
   * リソースロックを解放
   */
  private releaseResourceLocks(taskId: number): void {
    for (const [resource, lockedBy] of this.resourceLocks) {
      if (lockedBy === taskId) {
        this.resourceLocks.delete(resource);
      }
    }
  }

  /**
   * タスクを完了としてマーク
   */
  completeTask(taskId: number): void {
    const scheduled = this.scheduledTasks.get(taskId);
    if (!scheduled) return;

    scheduled.status = 'completed';
    scheduled.completedAt = new Date();
    this.runningTasks.delete(taskId);
    this.completedTasks.add(taskId);

    // リソースロックを解放
    this.releaseResourceLocks(taskId);

    this.emitEvent({
      type: 'task_completed',
      taskId,
      level: scheduled.level,
      timestamp: new Date(),
    });

    // レベル完了チェック
    this.checkLevelCompletion(scheduled.level);

    // 全タスク完了チェック
    this.checkAllCompletion();
  }

  /**
   * タスクを失敗としてマーク
   */
  failTask(taskId: number): void {
    const scheduled = this.scheduledTasks.get(taskId);
    if (!scheduled) return;

    scheduled.status = 'failed';
    scheduled.completedAt = new Date();
    this.runningTasks.delete(taskId);
    this.failedTasks.add(taskId);

    // リソースロックを解放
    this.releaseResourceLocks(taskId);

    this.emitEvent({
      type: 'task_failed',
      taskId,
      level: scheduled.level,
      timestamp: new Date(),
    });

    // 依存タスクをブロック状態に
    const node = this.nodes.get(taskId);
    if (node && node.dependents) {
      for (const dependentId of node.dependents) {
        this.blockedTasks.add(dependentId);
        const depScheduled = this.scheduledTasks.get(dependentId);
        if (depScheduled) {
          depScheduled.status = 'blocked';
        }
      }
    }
  }

  /**
   * レベル完了をチェック
   */
  private checkLevelCompletion(level: number): void {
    const group = this.plan.groups.find(g => g.level === level);
    if (!group) return;

    const allCompleted = group.taskIds.every(
      id => this.completedTasks.has(id) || this.failedTasks.has(id)
    );

    if (allCompleted && level === this.currentLevel) {
      this.currentLevel++;
      this.emitEvent({
        type: 'level_completed',
        level,
        timestamp: new Date(),
      });
    }
  }

  /**
   * 全タスク完了をチェック
   */
  private checkAllCompletion(): void {
    const allTaskIds = this.plan.groups.flatMap(g => g.taskIds);
    const allDone = allTaskIds.every(
      id => this.completedTasks.has(id) || this.failedTasks.has(id)
    );

    if (allDone) {
      this.emitEvent({
        type: 'all_completed',
        timestamp: new Date(),
        metadata: {
          completed: this.completedTasks.size,
          failed: this.failedTasks.size,
          total: allTaskIds.length,
        },
      });
    }
  }

  /**
   * 実行状態を取得
   */
  getStatus(): {
    currentLevel: number;
    running: number[];
    completed: number[];
    failed: number[];
    blocked: number[];
    pending: number[];
    progress: number;
  } {
    const allTaskIds = this.plan.groups.flatMap(g => g.taskIds);
    const pending = allTaskIds.filter(
      id =>
        !this.runningTasks.has(id) &&
        !this.completedTasks.has(id) &&
        !this.failedTasks.has(id) &&
        !this.blockedTasks.has(id)
    );

    const totalTasks = allTaskIds.length;
    const completedCount = this.completedTasks.size;
    const progress = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

    return {
      currentLevel: this.currentLevel,
      running: Array.from(this.runningTasks),
      completed: Array.from(this.completedTasks),
      failed: Array.from(this.failedTasks),
      blocked: Array.from(this.blockedTasks),
      pending,
      progress,
    };
  }

  /**
   * イベントリスナーを追加
   */
  addEventListener(listener: SchedulerEventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * イベントリスナーを削除
   */
  removeEventListener(listener: SchedulerEventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * イベントを発火
   */
  private emitEvent(event: SchedulerEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ParallelScheduler] Error in event listener:', error);
      }
    }
  }

  /**
   * 特定のタスクの状態を取得
   */
  getTaskStatus(taskId: number): ParallelExecutionStatus {
    if (this.runningTasks.has(taskId)) return 'running';
    if (this.completedTasks.has(taskId)) return 'completed';
    if (this.failedTasks.has(taskId)) return 'failed';
    if (this.blockedTasks.has(taskId)) return 'blocked';
    if (this.scheduledTasks.has(taskId)) return 'scheduled';
    return 'pending';
  }

  /**
   * 緊急タスクを割り込み追加
   */
  insertUrgentTask(taskId: number, node: TaskNode): void {
    const highestLevel = Math.max(...Array.from(this.scheduledTasks.values()).map(s => s.level));
    const urgentLevel = Math.max(0, this.currentLevel);

    this.nodes.set(taskId, node);
    this.scheduledTasks.set(taskId, {
      taskId,
      groupId: -1, // 特別グループ
      level: urgentLevel,
      priority: 1000, // 最高優先度
      scheduledAt: new Date(),
      status: 'scheduled',
    });

    this.emitEvent({
      type: 'task_scheduled',
      taskId,
      level: urgentLevel,
      timestamp: new Date(),
      metadata: { urgent: true },
    });
  }

  /**
   * タスクの優先度を変更
   */
  updateTaskPriority(taskId: number, newPriority: number): void {
    const scheduled = this.scheduledTasks.get(taskId);
    if (scheduled && !this.runningTasks.has(taskId) && !this.completedTasks.has(taskId)) {
      scheduled.priority = newPriority;
    }
  }

  /**
   * 推定残り時間を計算
   */
  getEstimatedRemainingTime(): number {
    let remaining = 0;

    for (const group of this.plan.groups) {
      if (group.level >= this.currentLevel) {
        const incompleteTasks = group.taskIds.filter(
          id => !this.completedTasks.has(id) && !this.failedTasks.has(id)
        );

        if (incompleteTasks.length > 0) {
          // グループ内の最大推定時間
          const maxDuration = Math.max(
            ...incompleteTasks.map(id => this.nodes.get(id)?.estimatedHours || 1)
          );
          remaining += maxDuration;
        }
      }
    }

    return remaining;
  }
}

/**
 * スケジューラーのファクトリー関数
 */
export function createParallelScheduler(
  plan: ParallelExecutionPlan,
  nodes: Map<number, TaskNode>,
  config: ParallelExecutionConfig
): ParallelScheduler {
  return new ParallelScheduler(plan, nodes, config);
}
