/**
 * Dependencies
 */

import { createLogger } from '../../config/logger';

const log = createLogger('parallel-scheduler');

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
 */
type SchedulerEvent = {
  type:
    | 'task_scheduled'
    | 'task_started'
    | 'task_completed'
    | 'task_failed'
    | 'level_completed'
    | 'all_completed';
  taskId?: number;
  level?: number;
  timestamp: Date;
  metadata?: Record<string, unknown>;
};

type SchedulerEventListener = (event: SchedulerEvent) => void;

/**
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

  private resourceLocks: Map<string, number> = new Map(); // resource -> taskId

  constructor(
    plan: ParallelExecutionPlan,
    nodes: Map<number, TaskNode>,
    config: ParallelExecutionConfig,
  ) {
    this.plan = plan;
    this.nodes = nodes;
    this.config = config;
    this.initializeSchedule();
  }

  /**
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
   */
  private calculatePriority(node: TaskNode): number {
    let priority = 0;

    if (
      this.plan.groups.some((g) => g.taskIds.includes(node.id) && g.internalDependencies.length > 0)
    ) {
      priority += 50;
    }

    switch (node.priority) {
      case 'urgent':
        priority += 40;
        break;
      case 'high':
        priority += 30;
        break;
      case 'medium':
        priority += 20;
        break;
      case 'low':
        priority += 10;
        break;
    }

    priority += (node.dependents?.length || 0) * 5;

    priority -= Math.min(20, node.estimatedHours * 2);

    return priority;
  }

  /**
   */
  getNextExecutableTasks(): number[] {
    const executable: { taskId: number; priority: number }[] = [];

    for (const [taskId, scheduled] of this.scheduledTasks) {
      if (
        this.runningTasks.has(taskId) ||
        this.completedTasks.has(taskId) ||
        this.failedTasks.has(taskId)
      ) {
        continue;
      }

      // Dependencies
      if (!this.canExecute(taskId)) {
        this.blockedTasks.add(taskId);
        continue;
      }

      // Constraints
      if (!this.checkResourceConstraints(taskId)) {
        continue;
      }

      // Max concurrent execution count
      if (this.runningTasks.size >= this.config.maxConcurrentAgents) {
        break;
      }

      executable.push({ taskId, priority: scheduled.priority });
    }

    executable.sort((a, b) => b.priority - a.priority);

    return executable
      .slice(0, this.config.maxConcurrentAgents - this.runningTasks.size)
      .map((e) => e.taskId);
  }

  /**
   */
  canExecute(taskId: number): boolean {
    const node = this.nodes.get(taskId);
    if (!node) return false;

    for (const depId of node.dependencies) {
      if (!this.completedTasks.has(depId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Constraints
   */
  private checkResourceConstraints(taskId: number): boolean {
    const node = this.nodes.get(taskId);
    if (!node) return false;

    for (const constraint of this.plan.resourceConstraints) {
      if (constraint.affectedTasks.includes(taskId)) {
        const concurrentUsage = Array.from(this.runningTasks).filter((runningId) =>
          constraint.affectedTasks.includes(runningId),
        ).length;

        if (concurrentUsage >= constraint.maxConcurrent) {
          return false;
        }
      }
    }

    return true;
  }

  /**
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
   */
  private acquireResourceLocks(taskId: number): void {
    const node = this.nodes.get(taskId);
    if (!node) return;

    for (const file of node.files) {
      this.resourceLocks.set(file, taskId);
    }
  }

  /**
   */
  private releaseResourceLocks(taskId: number): void {
    for (const [resource, lockedBy] of this.resourceLocks) {
      if (lockedBy === taskId) {
        this.resourceLocks.delete(resource);
      }
    }
  }

  /**
   */
  completeTask(taskId: number): void {
    const scheduled = this.scheduledTasks.get(taskId);
    if (!scheduled) return;

    scheduled.status = 'completed';
    scheduled.completedAt = new Date();
    this.runningTasks.delete(taskId);
    this.completedTasks.add(taskId);

    this.releaseResourceLocks(taskId);

    this.emitEvent({
      type: 'task_completed',
      taskId,
      level: scheduled.level,
      timestamp: new Date(),
    });

    this.checkLevelCompletion(scheduled.level);

    this.checkAllCompletion();
  }

  /**
   */
  failTask(taskId: number): void {
    const scheduled = this.scheduledTasks.get(taskId);
    if (!scheduled) return;

    scheduled.status = 'failed';
    scheduled.completedAt = new Date();
    this.runningTasks.delete(taskId);
    this.failedTasks.add(taskId);

    this.releaseResourceLocks(taskId);

    this.emitEvent({
      type: 'task_failed',
      taskId,
      level: scheduled.level,
      timestamp: new Date(),
    });

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
   */
  private checkLevelCompletion(level: number): void {
    const group = this.plan.groups.find((g) => g.level === level);
    if (!group) return;

    const allCompleted = group.taskIds.every(
      (id) => this.completedTasks.has(id) || this.failedTasks.has(id),
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
   */
  private checkAllCompletion(): void {
    const allTaskIds = this.plan.groups.flatMap((g) => g.taskIds);
    const allDone = allTaskIds.every(
      (id) => this.completedTasks.has(id) || this.failedTasks.has(id),
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
   * Execution state
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
    const allTaskIds = this.plan.groups.flatMap((g) => g.taskIds);
    const pending = allTaskIds.filter(
      (id) =>
        !this.runningTasks.has(id) &&
        !this.completedTasks.has(id) &&
        !this.failedTasks.has(id) &&
        !this.blockedTasks.has(id),
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
   */
  addEventListener(listener: SchedulerEventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   */
  removeEventListener(listener: SchedulerEventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   */
  private emitEvent(event: SchedulerEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        log.error({ err: error }, '[ParallelScheduler] Error in event listener');
      }
    }
  }

  /**
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
   */
  insertUrgentTask(taskId: number, node: TaskNode): void {
    const highestLevel = Math.max(...Array.from(this.scheduledTasks.values()).map((s) => s.level));
    const urgentLevel = Math.max(0, this.currentLevel);

    this.nodes.set(taskId, node);
    this.scheduledTasks.set(taskId, {
      taskId,
      groupId: -1, // Special group
      level: urgentLevel,
      priority: 1000, // Highest priority
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
   */
  updateTaskPriority(taskId: number, newPriority: number): void {
    const scheduled = this.scheduledTasks.get(taskId);
    if (scheduled && !this.runningTasks.has(taskId) && !this.completedTasks.has(taskId)) {
      scheduled.priority = newPriority;
    }
  }

  /**
   */
  getEstimatedRemainingTime(): number {
    let remaining = 0;

    for (const group of this.plan.groups) {
      if (group.level >= this.currentLevel) {
        const incompleteTasks = group.taskIds.filter(
          (id) => !this.completedTasks.has(id) && !this.failedTasks.has(id),
        );

        if (incompleteTasks.length > 0) {
          const maxDuration = Math.max(
            ...incompleteTasks.map((id) => this.nodes.get(id)?.estimatedHours || 1),
          );
          remaining += maxDuration;
        }
      }
    }

    return remaining;
  }
}

/**
 */
export function createParallelScheduler(
  plan: ParallelExecutionPlan,
  nodes: Map<number, TaskNode>,
  config: ParallelExecutionConfig,
): ParallelScheduler {
  return new ParallelScheduler(plan, nodes, config);
}
