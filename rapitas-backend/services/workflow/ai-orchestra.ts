/**
 * AI Orchestra Service
 *
 * Coordinates and manages multi-task execution like a conductor.
 * Handles task prioritization, dependency analysis, and concurrent execution.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { WorkflowQueueService, type EnqueueOptions } from './workflow-queue';
import { WorkflowRunner } from './workflow-runner';
import { realtimeService } from '../realtime-service';

const log = createLogger('ai-orchestra');

export interface OrchestraConfig {
  maxConcurrency?: number;
  autoStart?: boolean;
  priorityStrategy?: 'fifo' | 'priority' | 'dependency_aware';
}

export interface ConductResult {
  sessionId: number;
  enqueuedTasks: number;
  skippedTasks: number;
  errors: Array<{ taskId: number; error: string }>;
}

export interface OrchestraState {
  session: {
    id: number;
    status: string;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    startedAt: string | null;
  } | null;
  runner: {
    isRunning: boolean;
    activeItems: number;
    processedTotal: number;
  };
  queue: {
    queued: number;
    running: number;
    waitingApproval: number;
    completed: number;
    failed: number;
  };
}

interface TaskWithRelations {
  id: number;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  estimatedHours: number | null;
  workflowStatus: string | null;
  workflowMode: string | null;
  themeId: number | null;
  parentId: number | null;
}

export class AIOrchestra {
  private static instance: AIOrchestra;
  private currentSessionId: number | null = null;
  private queue: WorkflowQueueService;
  private runner: WorkflowRunner;

  private constructor() {
    this.queue = WorkflowQueueService.getInstance();
    this.runner = WorkflowRunner.getInstance();
  }

  static getInstance(): AIOrchestra {
    if (!AIOrchestra.instance) {
      AIOrchestra.instance = new AIOrchestra();
    }
    return AIOrchestra.instance;
  }

  /**
   * Start orchestration for multiple tasks.
   */
  async conductWorkflow(taskIds: number[], config: OrchestraConfig = {}): Promise<ConductResult> {
    const { maxConcurrency = 3, autoStart = true, priorityStrategy = 'dependency_aware' } = config;

    // Stop existing active session if any
    if (this.currentSessionId) {
      await this.stop();
    }

    // Create session
    const session = await prisma.orchestraSession.create({
      data: {
        status: 'conducting',
        maxConcurrency,
        totalTasks: taskIds.length,
        startedAt: new Date(),
        metadata: JSON.stringify({ priorityStrategy, config }),
      },
    });
    this.currentSessionId = session.id;

    // Set queue concurrency
    this.queue.setMaxConcurrency(maxConcurrency);

    // Fetch task information
    const tasks = (await prisma.task.findMany({
      where: { id: { in: taskIds } },
    })) as TaskWithRelations[];

    // Analyze dependencies
    const dependencyMap = await this.analyzeDependencies(tasks);

    // Calculate priorities
    const prioritizedTasks = this.prioritizeTasks(tasks, dependencyMap, priorityStrategy);

    // Enqueue tasks
    const errors: Array<{ taskId: number; error: string }> = [];
    let enqueuedCount = 0;
    let skippedCount = 0;

    for (const { task, priority, dependencies } of prioritizedTasks) {
      // Skip completed tasks
      if (task.status === 'done' || task.workflowStatus === 'completed') {
        skippedCount++;
        continue;
      }

      try {
        await this.queue.enqueue({
          taskId: task.id,
          priority,
          dependencies,
          orchestraSessionId: session.id,
        });
        enqueuedCount++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ taskId: task.id, error: msg });
        log.warn(`[AIOrchestra] Failed to enqueue task ${task.id}: ${msg}`);
      }
    }

    // Update session
    await prisma.orchestraSession.update({
      where: { id: session.id },
      data: { totalTasks: enqueuedCount },
    });

    log.info(
      `[AIOrchestra] Session ${session.id}: enqueued ${enqueuedCount}, skipped ${skippedCount}, errors ${errors.length}`,
    );

    // Start runner
    if (autoStart && enqueuedCount > 0) {
      this.runner.startProcessing();
    }

    this.broadcastState('orchestra_started');

    return {
      sessionId: session.id,
      enqueuedTasks: enqueuedCount,
      skippedTasks: skippedCount,
      errors,
    };
  }

  /**
   * Stop orchestration.
   */
  async stop(): Promise<void> {
    await this.runner.stopProcessing();

    if (this.currentSessionId) {
      // Tally completed and failed counts
      const items = await this.queue.getSessionItems(this.currentSessionId);
      const completed = items.filter((i) => i.status === 'completed').length;
      const failed = items.filter((i) => i.status === 'failed').length;

      await prisma.orchestraSession.update({
        where: { id: this.currentSessionId },
        data: {
          status: 'paused',
          completedTasks: completed,
          failedTasks: failed,
        },
      });
      log.info(`[AIOrchestra] Session ${this.currentSessionId} paused`);
    }

    this.broadcastState('orchestra_stopped');
  }

  /**
   * Resume a paused orchestration.
   */
  async resume(): Promise<boolean> {
    if (!this.currentSessionId) {
      // Find the latest paused session
      const session = await prisma.orchestraSession.findFirst({
        where: { status: 'paused' },
        orderBy: { updatedAt: 'desc' },
      });
      if (!session) return false;
      this.currentSessionId = session.id;
    }

    await prisma.orchestraSession.update({
      where: { id: this.currentSessionId },
      data: { status: 'conducting' },
    });

    this.runner.startProcessing();
    this.broadcastState('orchestra_resumed');
    return true;
  }

  /**
   * Get the current orchestra state.
   */
  async getState(): Promise<OrchestraState> {
    let sessionData = null;

    if (this.currentSessionId) {
      const session = await prisma.orchestraSession.findUnique({
        where: { id: this.currentSessionId },
      });
      if (session) {
        // Get latest counts
        const items = await this.queue.getSessionItems(this.currentSessionId);
        const completed = items.filter((i) => i.status === 'completed').length;
        const failed = items.filter((i) => i.status === 'failed').length;

        sessionData = {
          id: session.id,
          status: session.status,
          totalTasks: session.totalTasks,
          completedTasks: completed,
          failedTasks: failed,
          startedAt: session.startedAt?.toISOString() || null,
        };
      }
    }

    const runnerStatus = this.runner.getStatus();
    const queueState = await this.queue.getQueueState(this.currentSessionId ?? undefined);

    return {
      session: sessionData,
      runner: {
        isRunning: runnerStatus.isRunning,
        activeItems: runnerStatus.activeItems,
        processedTotal: runnerStatus.processedTotal,
      },
      queue: {
        queued: queueState.queued.length,
        running: queueState.running.length,
        waitingApproval: queueState.waitingApproval.length,
        completed: queueState.completed.length,
        failed: queueState.failed.length,
      },
    };
  }

  /**
   * Enqueue a single task.
   */
  async enqueueTask(
    options: EnqueueOptions,
  ): Promise<{ success: boolean; itemId?: number; error?: string }> {
    try {
      if (this.currentSessionId) {
        options.orchestraSessionId = this.currentSessionId;
      }
      const item = await this.queue.enqueue(options);

      // Update session total task count
      if (this.currentSessionId) {
        await prisma.orchestraSession.update({
          where: { id: this.currentSessionId },
          data: { totalTasks: { increment: 1 } },
        });
      }

      // Start runner if stopped
      if (!this.runner.getStatus().isRunning) {
        this.runner.startProcessing();
      }

      return { success: true, itemId: item.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg };
    }
  }

  /**
   * Analyze inter-task dependencies (with cycle detection).
   */
  private async analyzeDependencies(tasks: TaskWithRelations[]): Promise<Map<number, number[]>> {
    const depMap = new Map<number, number[]>();
    const taskIdSet = new Set(tasks.map((t) => t.id));

    for (const task of tasks) {
      const deps: number[] = [];

      // Dependency on parent task
      if (task.parentId && taskIdSet.has(task.parentId)) {
        deps.push(task.parentId);
      }

      // TODO: Implement DB-based dependency fetching when TaskDependency model is added.
      // Currently manages dependencies via parent-child and same-theme ordering only.

      // Same-theme preceding tasks (sequential to avoid git conflicts)
      if (task.themeId) {
        const sameThemeTasks = tasks.filter(
          (t) => t.themeId === task.themeId && t.id !== task.id && t.id < task.id,
        );
        for (const st of sameThemeTasks) {
          if (!deps.includes(st.id)) {
            deps.push(st.id);
          }
        }
      }

      depMap.set(task.id, deps);
    }

    // Cycle detection
    const cycles = this.detectCyclicDependencies(depMap);
    if (cycles.length > 0) {
      const cycleStrings = cycles.map((cycle) => cycle.join(' -> '));
      log.warn(`[AIOrchestra] Circular dependencies detected: ${cycleStrings.join(', ')}`);
      throw new Error(`Circular dependencies detected: ${cycleStrings.join(', ')}`);
    }

    return depMap;
  }

  /**
   * Detect cyclic dependencies (DFS with White/Gray/Black state tracking).
   */
  private detectCyclicDependencies(depMap: Map<number, number[]>): number[][] {
    const WHITE = 0; // Unvisited
    const GRAY = 1; // In progress (on stack)
    const BLACK = 2; // Completed

    const colors = new Map<number, number>();
    const cycles: number[][] = [];
    const currentPath: number[] = [];

    // Initialize all nodes
    for (const taskId of depMap.keys()) {
      colors.set(taskId, WHITE);
    }

    const dfs = (taskId: number): boolean => {
      if (colors.get(taskId) === GRAY) {
        // Cycle detected
        const cycleStart = currentPath.indexOf(taskId);
        if (cycleStart >= 0) {
          cycles.push([...currentPath.slice(cycleStart), taskId]);
        }
        return true;
      }

      if (colors.get(taskId) === BLACK) {
        return false; // Already processed
      }

      colors.set(taskId, GRAY);
      currentPath.push(taskId);

      const dependencies = depMap.get(taskId) || [];
      for (const depTaskId of dependencies) {
        if (dfs(depTaskId)) {
          return true; // Cycle already detected
        }
      }

      currentPath.pop();
      colors.set(taskId, BLACK);
      return false;
    };

    // Explore all nodes
    for (const taskId of depMap.keys()) {
      if (colors.get(taskId) === WHITE) {
        dfs(taskId);
      }
    }

    return cycles;
  }

  /**
   * Calculate task priorities.
   */
  private prioritizeTasks(
    tasks: TaskWithRelations[],
    dependencyMap: Map<number, number[]>,
    strategy: string,
  ): Array<{ task: TaskWithRelations; priority: number; dependencies: number[] }> {
    const result = tasks.map((task) => {
      let priority = 50; // Default

      if (strategy === 'fifo') {
        // FIFO: lower ID goes first
        priority = Math.max(0, 100 - task.id);
      } else {
        // priority/dependency_aware
        // Convert task priority string to numeric score
        const priorityScore: Record<string, number> = {
          urgent: 90,
          high: 75,
          medium: 50,
          low: 25,
        };
        priority = priorityScore[task.priority] || 50;

        // Slight priority boost for short-estimate tasks (small-task-first)
        if (task.estimatedHours && task.estimatedHours <= 1) {
          priority += 10;
        }

        // Fewer dependencies = higher priority
        const deps = dependencyMap.get(task.id) || [];
        priority += Math.max(0, 10 - deps.length * 3);
      }

      return {
        task,
        priority: Math.max(0, Math.min(100, priority)),
        dependencies: dependencyMap.get(task.id) || [],
      };
    });

    // Sort by priority descending
    result.sort((a, b) => b.priority - a.priority);
    return result;
  }

  /**
   * Resume queue processing after plan approval.
   */
  async handlePlanApproved(taskId: number): Promise<void> {
    const resumed = await this.runner.resumeAfterApproval(taskId);
    if (resumed) {
      this.broadcastState('task_resumed');
    }
  }

  /**
   * Recover state on server startup.
   */
  async recoverOnStartup(): Promise<void> {
    // Recover stale queue items
    const recovered = await this.queue.recoverStaleItems();

    // Restore active session
    const activeSession = await prisma.orchestraSession.findFirst({
      where: { status: 'conducting' },
      orderBy: { updatedAt: 'desc' },
    });

    if (activeSession) {
      this.currentSessionId = activeSession.id;
      this.queue.setMaxConcurrency(activeSession.maxConcurrency);
      log.info(`[AIOrchestra] Recovered session ${activeSession.id} with ${recovered} stale items`);

      // Auto-resume
      this.runner.startProcessing();
    }
  }

  /**
   * Broadcast state via SSE.
   */
  private async broadcastState(event: string): Promise<void> {
    try {
      const state = await this.getState();
      realtimeService.broadcast('orchestra', event, {
        state,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Ignore SSE errors
    }
  }
}
