/**
 * Workflow Queue Service
 * ワークフロータスクのキュー管理を行う。
 * インメモリキュー + DB永続化のハイブリッド方式。
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow-queue');

export interface QueueItem {
  id: number;
  taskId: number;
  orchestraSessionId: number | null;
  priority: number;
  status: string;
  currentPhase: string;
  dependencies: number[];
  retryCount: number;
  maxRetries: number;
  errorMessage: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface EnqueueOptions {
  taskId: number;
  priority?: number;
  dependencies?: number[];
  orchestraSessionId?: number;
}

export interface QueueState {
  queued: QueueItem[];
  running: QueueItem[];
  waitingApproval: QueueItem[];
  completed: QueueItem[];
  failed: QueueItem[];
  totalItems: number;
  maxConcurrency: number;
}

export class WorkflowQueueService {
  private static instance: WorkflowQueueService;
  private maxConcurrency = 3;

  static getInstance(): WorkflowQueueService {
    if (!WorkflowQueueService.instance) {
      WorkflowQueueService.instance = new WorkflowQueueService();
    }
    return WorkflowQueueService.instance;
  }

  setMaxConcurrency(max: number): void {
    this.maxConcurrency = Math.max(1, Math.min(10, max));
  }

  getMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  /**
   * タスクをキューに追加
   */
  async enqueue(options: EnqueueOptions): Promise<QueueItem> {
    const { taskId, priority = 50, dependencies = [], orchestraSessionId } = options;

    // タスクの存在確認
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // 重複チェック（同一セッション内）
    const existing = await prisma.workflowQueueItem.findFirst({
      where: {
        taskId,
        orchestraSessionId: orchestraSessionId ?? null,
        status: { in: ['queued', 'running', 'waiting_approval'] },
      },
    });
    if (existing) {
      throw new Error(`Task ${taskId} is already in the queue (status: ${existing.status})`);
    }

    const item = await prisma.workflowQueueItem.create({
      data: {
        taskId,
        orchestraSessionId: orchestraSessionId ?? null,
        priority,
        status: 'queued',
        currentPhase: (task.workflowStatus as string) || 'draft',
        dependencies: JSON.stringify(dependencies),
      },
    });

    log.info(`[WorkflowQueue] Enqueued task ${taskId} with priority ${priority}`);
    return this.mapToQueueItem(item);
  }

  /**
   * 実行可能な次のアイテムを取得（依存関係チェック付き、競合状態対策あり）
   */
  async dequeue(): Promise<QueueItem | null> {
    // 現在の実行中アイテム数をチェック
    const runningCount = await prisma.workflowQueueItem.count({
      where: { status: 'running' },
    });
    if (runningCount >= this.maxConcurrency) {
      return null;
    }

    // 優先度順でキュー内のアイテムを取得
    const candidates = await prisma.workflowQueueItem.findMany({
      where: { status: 'queued' },
      orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
    });

    for (const candidate of candidates) {
      try {
        const deps = JSON.parse(candidate.dependencies || '[]') as number[];

        // 依存タスクがすべて完了（またはキャンセル）しているかチェック
        if (deps.length > 0) {
          const incompleteDeps = await prisma.workflowQueueItem.count({
            where: {
              taskId: { in: deps },
              orchestraSessionId: candidate.orchestraSessionId,
              status: { notIn: ['completed', 'cancelled'] },
            },
          });
          if (incompleteDeps > 0) continue;
        }

        // 実行開始（トランザクションで競合状態を防止）
        const updated = await prisma.$transaction(async (tx) => {
          // 再度ステータスを確認（他のワーカーが先に取得した可能性）
          const current = await tx.workflowQueueItem.findUnique({
            where: { id: candidate.id },
          });
          if (!current || current.status !== 'queued') {
            return null; // 他のワーカーが取得済み
          }

          // 並行実行数を再チェック
          const currentRunning = await tx.workflowQueueItem.count({
            where: { status: 'running' },
          });
          if (currentRunning >= this.maxConcurrency) {
            return null; // 並行実行数上限に達した
          }

          return tx.workflowQueueItem.update({
            where: { id: candidate.id },
            data: { status: 'running', startedAt: new Date() },
          });
        });

        if (updated) {
          log.info(`[WorkflowQueue] Dequeued task ${candidate.taskId} (item ${candidate.id})`);
          return this.mapToQueueItem(updated);
        }
        // 競合により取得できなかった場合は次の候補へ
      } catch (error) {
        log.warn({ err: error }, `[WorkflowQueue] Failed to dequeue candidate ${candidate.id}`);
        continue; // 次の候補を試行
      }
    }

    return null;
  }

  /**
   * アイテムのステータスを更新
   */
  async updateStatus(
    itemId: number,
    status: string,
    extra?: { currentPhase?: string; errorMessage?: string; result?: string },
  ): Promise<QueueItem> {
    const data: Record<string, unknown> = { status };
    if (extra?.currentPhase) data.currentPhase = extra.currentPhase;
    if (extra?.errorMessage) data.errorMessage = extra.errorMessage;
    if (extra?.result) data.result = extra.result;
    if (status === 'completed' || status === 'failed') {
      data.completedAt = new Date();
    }

    const updated = await prisma.workflowQueueItem.update({
      where: { id: itemId },
      data,
    });
    return this.mapToQueueItem(updated);
  }

  /**
   * リトライ可能かチェックし、リトライ実行
   */
  async retryIfPossible(itemId: number): Promise<boolean> {
    const item = await prisma.workflowQueueItem.findUnique({ where: { id: itemId } });
    if (!item) return false;

    if (item.retryCount >= item.maxRetries) {
      await this.updateStatus(itemId, 'failed', {
        errorMessage: `Max retries (${item.maxRetries}) exceeded`,
      });
      return false;
    }

    await prisma.workflowQueueItem.update({
      where: { id: itemId },
      data: {
        status: 'queued',
        retryCount: item.retryCount + 1,
        startedAt: null,
        errorMessage: null,
      },
    });
    log.info(`[WorkflowQueue] Retry ${item.retryCount + 1}/${item.maxRetries} for item ${itemId}`);
    return true;
  }

  /**
   * キューアイテムをキャンセル
   */
  async cancel(itemId: number): Promise<QueueItem> {
    return this.updateStatus(itemId, 'cancelled');
  }

  /**
   * 優先度を変更
   */
  async updatePriority(itemId: number, priority: number): Promise<QueueItem> {
    const updated = await prisma.workflowQueueItem.update({
      where: { id: itemId },
      data: { priority: Math.max(0, Math.min(100, priority)) },
    });
    return this.mapToQueueItem(updated);
  }

  /**
   * 現在のキュー状態を取得
   */
  async getQueueState(sessionId?: number): Promise<QueueState> {
    const where = sessionId ? { orchestraSessionId: sessionId } : {};

    const items = await prisma.workflowQueueItem.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
    });

    const mapped = items.map((i) => this.mapToQueueItem(i));

    return {
      queued: mapped.filter((i) => i.status === 'queued'),
      running: mapped.filter((i) => i.status === 'running'),
      waitingApproval: mapped.filter((i) => i.status === 'waiting_approval'),
      completed: mapped.filter((i) => i.status === 'completed'),
      failed: mapped.filter((i) => i.status === 'failed'),
      totalItems: mapped.length,
      maxConcurrency: this.maxConcurrency,
    };
  }

  /**
   * セッション内のアイテムを取得
   */
  async getSessionItems(sessionId: number): Promise<QueueItem[]> {
    const items = await prisma.workflowQueueItem.findMany({
      where: { orchestraSessionId: sessionId },
      orderBy: [{ priority: 'desc' }, { queuedAt: 'asc' }],
    });
    return items.map((i) => this.mapToQueueItem(i));
  }

  /**
   * サーバー再起動時にrunningステータスのアイテムをqueuedに戻す
   */
  async recoverStaleItems(): Promise<number> {
    const result = await prisma.workflowQueueItem.updateMany({
      where: { status: 'running' },
      data: { status: 'queued', startedAt: null },
    });
    if (result.count > 0) {
      log.info(`[WorkflowQueue] Recovered ${result.count} stale running items to queued`);
    }
    return result.count;
  }

  /**
   * タスクIDからキューアイテムを検索
   */
  async findByTaskId(taskId: number, sessionId?: number): Promise<QueueItem | null> {
    const item = await prisma.workflowQueueItem.findFirst({
      where: {
        taskId,
        ...(sessionId ? { orchestraSessionId: sessionId } : {}),
        status: { in: ['queued', 'running', 'waiting_approval'] },
      },
    });
    return item ? this.mapToQueueItem(item) : null;
  }

  private mapToQueueItem(item: {
    id: number;
    taskId: number;
    orchestraSessionId: number | null;
    priority: number;
    status: string;
    currentPhase: string;
    dependencies: string;
    retryCount: number;
    maxRetries: number;
    errorMessage: string | null;
    queuedAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  }): QueueItem {
    return {
      id: item.id,
      taskId: item.taskId,
      orchestraSessionId: item.orchestraSessionId,
      priority: item.priority,
      status: item.status,
      currentPhase: item.currentPhase,
      dependencies: JSON.parse(item.dependencies || '[]'),
      retryCount: item.retryCount,
      maxRetries: item.maxRetries,
      errorMessage: item.errorMessage,
      queuedAt: item.queuedAt,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
    };
  }
}
