/**
 * AI Orchestra Service
 * AIオーケストラ（指揮者）が複数タスクの実行を調整・管理する。
 * タスクの優先順位付け、依存関係分析、並行実行管理を担う。
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
   * 複数タスクのオーケストレーションを開始
   */
  async conductWorkflow(
    taskIds: number[],
    config: OrchestraConfig = {},
  ): Promise<ConductResult> {
    const { maxConcurrency = 3, autoStart = true, priorityStrategy = 'dependency_aware' } = config;

    // 既存のアクティブセッションがあれば停止
    if (this.currentSessionId) {
      await this.stop();
    }

    // セッション作成
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

    // キューの並行数設定
    this.queue.setMaxConcurrency(maxConcurrency);

    // タスク情報を取得
    const tasks = await prisma.task.findMany({
      where: { id: { in: taskIds } },
    }) as TaskWithRelations[];

    // 依存関係を分析
    const dependencyMap = await this.analyzeDependencies(tasks);

    // 優先順位を計算
    const prioritizedTasks = this.prioritizeTasks(tasks, dependencyMap, priorityStrategy);

    // キューに追加
    const errors: Array<{ taskId: number; error: string }> = [];
    let enqueuedCount = 0;
    let skippedCount = 0;

    for (const { task, priority, dependencies } of prioritizedTasks) {
      // 完了済みタスクはスキップ
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

    // セッション更新
    await prisma.orchestraSession.update({
      where: { id: session.id },
      data: { totalTasks: enqueuedCount },
    });

    log.info(
      `[AIOrchestra] Session ${session.id}: enqueued ${enqueuedCount}, skipped ${skippedCount}, errors ${errors.length}`,
    );

    // ランナー開始
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
   * オーケストレーションを停止
   */
  async stop(): Promise<void> {
    await this.runner.stopProcessing();

    if (this.currentSessionId) {
      // 完了・失敗数を集計
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
   * 停止したオーケストレーションを再開
   */
  async resume(): Promise<boolean> {
    if (!this.currentSessionId) {
      // 最新のpausedセッションを探す
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
   * 現在のオーケストラ状態を取得
   */
  async getState(): Promise<OrchestraState> {
    let sessionData = null;

    if (this.currentSessionId) {
      const session = await prisma.orchestraSession.findUnique({
        where: { id: this.currentSessionId },
      });
      if (session) {
        // 最新の集計を取得
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
   * 単一タスクをキューに追加
   */
  async enqueueTask(options: EnqueueOptions): Promise<{ success: boolean; itemId?: number; error?: string }> {
    try {
      if (this.currentSessionId) {
        options.orchestraSessionId = this.currentSessionId;
      }
      const item = await this.queue.enqueue(options);

      // セッションの総タスク数を更新
      if (this.currentSessionId) {
        await prisma.orchestraSession.update({
          where: { id: this.currentSessionId },
          data: { totalTasks: { increment: 1 } },
        });
      }

      // ランナーが停止中なら開始
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
   * タスク間の依存関係を分析（循環依存検出付き）
   */
  private async analyzeDependencies(
    tasks: TaskWithRelations[],
  ): Promise<Map<number, number[]>> {
    const depMap = new Map<number, number[]>();
    const taskIdSet = new Set(tasks.map((t) => t.id));

    for (const task of tasks) {
      const deps: number[] = [];

      // 親タスクへの依存
      if (task.parentId && taskIdSet.has(task.parentId)) {
        deps.push(task.parentId);
      }

      // TODO: TaskDependencyモデル追加時にDB依存関係取得を実装
      // 現時点ではparent-child関係と同一テーマ順序のみで依存関係を管理

      // 同一テーマの先行タスク（同テーマではgit競合を避けるため逐次実行）
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

    // 循環依存検出
    const cycles = this.detectCyclicDependencies(depMap);
    if (cycles.length > 0) {
      const cycleStrings = cycles.map((cycle) => cycle.join(' -> '));
      log.warn(`[AIOrchestra] Circular dependencies detected: ${cycleStrings.join(', ')}`);
      throw new Error(`Circular dependencies detected: ${cycleStrings.join(', ')}`);
    }

    return depMap;
  }

  /**
   * 循環依存を検出（DFS + White/Gray/Black状態管理）
   */
  private detectCyclicDependencies(depMap: Map<number, number[]>): number[][] {
    const WHITE = 0; // 未訪問
    const GRAY = 1; // 訪問中（スタック上）
    const BLACK = 2; // 訪問完了

    const colors = new Map<number, number>();
    const cycles: number[][] = [];
    const currentPath: number[] = [];

    // 全ノードを初期化
    for (const taskId of depMap.keys()) {
      colors.set(taskId, WHITE);
    }

    const dfs = (taskId: number): boolean => {
      if (colors.get(taskId) === GRAY) {
        // 循環検出
        const cycleStart = currentPath.indexOf(taskId);
        if (cycleStart >= 0) {
          cycles.push([...currentPath.slice(cycleStart), taskId]);
        }
        return true;
      }

      if (colors.get(taskId) === BLACK) {
        return false; // 既に処理済み
      }

      colors.set(taskId, GRAY);
      currentPath.push(taskId);

      const dependencies = depMap.get(taskId) || [];
      for (const depTaskId of dependencies) {
        if (dfs(depTaskId)) {
          return true; // 循環検出済み
        }
      }

      currentPath.pop();
      colors.set(taskId, BLACK);
      return false;
    };

    // 全ノードを探索
    for (const taskId of depMap.keys()) {
      if (colors.get(taskId) === WHITE) {
        dfs(taskId);
      }
    }

    return cycles;
  }

  /**
   * タスクの優先順位を計算
   */
  private prioritizeTasks(
    tasks: TaskWithRelations[],
    dependencyMap: Map<number, number[]>,
    strategy: string,
  ): Array<{ task: TaskWithRelations; priority: number; dependencies: number[] }> {
    const result = tasks.map((task) => {
      let priority = 50; // デフォルト

      if (strategy === 'fifo') {
        // FIFO: IDが小さいものが先
        priority = Math.max(0, 100 - task.id);
      } else {
        // priority/dependency_aware
        // タスクのpriority文字列をスコアに変換
        const priorityScore: Record<string, number> = {
          urgent: 90,
          high: 75,
          medium: 50,
          low: 25,
        };
        priority = priorityScore[task.priority] || 50;

        // 推定工数が短いものを少し優先（スモールタスクファースト）
        if (task.estimatedHours && task.estimatedHours <= 1) {
          priority += 10;
        }

        // 依存関係が少ないものを優先
        const deps = dependencyMap.get(task.id) || [];
        priority += Math.max(0, 10 - deps.length * 3);
      }

      return {
        task,
        priority: Math.max(0, Math.min(100, priority)),
        dependencies: dependencyMap.get(task.id) || [],
      };
    });

    // 優先度降順でソート
    result.sort((a, b) => b.priority - a.priority);
    return result;
  }

  /**
   * plan承認時にキューを再開
   */
  async handlePlanApproved(taskId: number): Promise<void> {
    const resumed = await this.runner.resumeAfterApproval(taskId);
    if (resumed) {
      this.broadcastState('task_resumed');
    }
  }

  /**
   * サーバー起動時のリカバリ
   */
  async recoverOnStartup(): Promise<void> {
    // スタック中のキューアイテムを復元
    const recovered = await this.queue.recoverStaleItems();

    // アクティブなセッションを復元
    const activeSession = await prisma.orchestraSession.findFirst({
      where: { status: 'conducting' },
      orderBy: { updatedAt: 'desc' },
    });

    if (activeSession) {
      this.currentSessionId = activeSession.id;
      this.queue.setMaxConcurrency(activeSession.maxConcurrency);
      log.info(
        `[AIOrchestra] Recovered session ${activeSession.id} with ${recovered} stale items`,
      );

      // 自動再開
      this.runner.startProcessing();
    }
  }

  /**
   * SSE経由で状態ブロードキャスト
   */
  private async broadcastState(event: string): Promise<void> {
    try {
      const state = await this.getState();
      realtimeService.broadcast('orchestra', event, {
        state,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // SSEエラーは無視
    }
  }
}
