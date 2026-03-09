/**
 * Workflow Runner Service
 * キューからタスクを取り出し、ワークフローの各フェーズを非同期実行する。
 * WorkflowOrchestrator（既存）を利用してフェーズ進行を行う。
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { WorkflowQueueService, type QueueItem } from './workflow-queue';
import { WorkflowOrchestrator } from './workflow-orchestrator';
import { realtimeService } from '../realtime-service';

const log = createLogger('workflow-runner');

export interface RunnerStatus {
  isRunning: boolean;
  activeItems: number;
  processedTotal: number;
  pollIntervalMs: number;
}

interface ActiveExecution {
  queueItemId: number;
  taskId: number;
  startedAt: Date;
  currentPhase: string;
  abortController: AbortController;
}

export class WorkflowRunner {
  private static instance: WorkflowRunner;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs = 5000;
  private processedTotal = 0;
  private activeExecutions = new Map<number, ActiveExecution>();
  private queue: WorkflowQueueService;
  private orchestrator: WorkflowOrchestrator;

  private constructor() {
    this.queue = WorkflowQueueService.getInstance();
    this.orchestrator = WorkflowOrchestrator.getInstance();
  }

  static getInstance(): WorkflowRunner {
    if (!WorkflowRunner.instance) {
      WorkflowRunner.instance = new WorkflowRunner();
    }
    return WorkflowRunner.instance;
  }

  /**
   * キューの監視・処理ループを開始
   */
  startProcessing(intervalMs?: number): void {
    if (this.running) {
      log.warn('[WorkflowRunner] Already running');
      return;
    }

    this.running = true;
    if (intervalMs) this.pollIntervalMs = intervalMs;

    log.info(`[WorkflowRunner] Started processing (poll interval: ${this.pollIntervalMs}ms)`);
    this.broadcastStatus('runner_started');

    // 即座に1回処理してからインターバル開始
    this.processQueue();
    this.pollTimer = setInterval(() => this.processQueue(), this.pollIntervalMs);
  }

  /**
   * グレースフルシャットダウン
   */
  async stopProcessing(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // アクティブな実行をキャンセル
    for (const [itemId, exec] of this.activeExecutions) {
      exec.abortController.abort();
      try {
        await this.queue.updateStatus(itemId, 'queued', {
          errorMessage: 'Runner shutdown - returned to queue',
        });
      } catch (e) {
        log.warn({ err: e }, `[WorkflowRunner] Failed to requeue item ${itemId}`);
      }
    }
    this.activeExecutions.clear();

    log.info('[WorkflowRunner] Stopped processing');
    this.broadcastStatus('runner_stopped');
  }

  /**
   * ランナーの状態を取得
   */
  getStatus(): RunnerStatus {
    return {
      isRunning: this.running,
      activeItems: this.activeExecutions.size,
      processedTotal: this.processedTotal,
      pollIntervalMs: this.pollIntervalMs,
    };
  }

  /**
   * キューからアイテムを取得して処理
   */
  private async processQueue(): Promise<void> {
    if (!this.running) return;

    try {
      // 空きスロットがある限りデキュー
      while (this.activeExecutions.size < this.queue.getMaxConcurrency()) {
        const item = await this.queue.dequeue();
        if (!item) break;

        // 非同期で実行開始（awaitしない）
        this.executeWorkflowItem(item);
      }
    } catch (error) {
      log.error({ err: error }, '[WorkflowRunner] Error in processQueue');
    }
  }

  /**
   * 単一タスクのワークフロー全体を非同期実行
   */
  private async executeWorkflowItem(item: QueueItem): Promise<void> {
    const abortController = new AbortController();
    const execution: ActiveExecution = {
      queueItemId: item.id,
      taskId: item.taskId,
      startedAt: new Date(),
      currentPhase: item.currentPhase,
      abortController,
    };

    this.activeExecutions.set(item.id, execution);
    this.broadcastItemUpdate(item.id, item.taskId, 'execution_started', item.currentPhase);

    try {
      // ワークフローを現在のフェーズから完了まで進行（無限ループ防止）
      let continueLoop = true;
      const maxIterations = 20; // 無限ループ防止
      let iterationCount = 0;

      while (continueLoop && !abortController.signal.aborted && iterationCount < maxIterations) {
        iterationCount++;
        // タスクの現在のworkflowStatusを確認
        const task = await prisma.task.findUnique({ where: { id: item.taskId } });
        if (!task) {
          throw new Error(`Task ${item.taskId} not found`);
        }

        const currentStatus = task.workflowStatus || 'draft';
        execution.currentPhase = currentStatus;

        // 完了チェック
        if (currentStatus === 'completed' || currentStatus === 'verify_done') {
          await this.queue.updateStatus(item.id, 'completed', {
            currentPhase: currentStatus,
            result: JSON.stringify({ completedAt: new Date().toISOString() }),
          });
          this.broadcastItemUpdate(item.id, item.taskId, 'workflow_completed', currentStatus);
          continueLoop = false;
          break;
        }

        // plan_created の場合は承認待ち
        if (currentStatus === 'plan_created') {
          await this.queue.updateStatus(item.id, 'waiting_approval', {
            currentPhase: 'plan_created',
          });
          this.broadcastItemUpdate(item.id, item.taskId, 'waiting_approval', 'plan_created');
          continueLoop = false;
          break;
        }

        // フェーズ遷移をログに記録
        await this.logPhaseTransition(item.taskId, currentStatus, 'advancing');

        // 次のフェーズを実行（タイムアウト付き）
        this.broadcastItemUpdate(item.id, item.taskId, 'phase_started', currentStatus);

        const executionPromise = this.orchestrator.advanceWorkflow(item.taskId);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Phase execution timeout for task ${item.taskId} (10 minutes)`));
          }, 10 * 60 * 1000); // 10分タイムアウト
        });

        const result = await Promise.race([executionPromise, timeoutPromise]);

        if (!result.success) {
          // リトライ可能かチェック
          const retried = await this.queue.retryIfPossible(item.id);
          if (!retried) {
            this.broadcastItemUpdate(item.id, item.taskId, 'execution_failed', currentStatus);
          } else {
            this.broadcastItemUpdate(item.id, item.taskId, 'execution_retrying', currentStatus);
          }
          continueLoop = false;
          break;
        }

        // フェーズ完了通知 + ログ記録
        await this.logPhaseTransition(item.taskId, currentStatus, result.status);
        await this.queue.updateStatus(item.id, 'running', {
          currentPhase: result.status,
        });
        this.broadcastItemUpdate(item.id, item.taskId, 'phase_completed', result.status);

        // 次のフェーズへ進む前に少し待機（DB更新の安定化 + アボートチェック）
        await new Promise((resolve) => {
          const waitTimeout = setTimeout(resolve, 1000);
          abortController.signal.addEventListener('abort', () => {
            clearTimeout(waitTimeout);
            resolve(undefined);
          }, { once: true });
        });
      }

      if (iterationCount >= maxIterations) {
        throw new Error(`Maximum iterations (${maxIterations}) exceeded for task ${item.taskId}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`[WorkflowRunner] Execution error for task ${item.taskId}: ${errorMsg}`);

      try {
        const retried = await this.queue.retryIfPossible(item.id);
        if (!retried) {
          await this.queue.updateStatus(item.id, 'failed', { errorMessage: errorMsg });
        }
      } catch (retryError) {
        log.error({ err: retryError }, `[WorkflowRunner] Failed to retry/fail item ${item.id}`);
      }
      this.broadcastItemUpdate(item.id, item.taskId, 'execution_error', execution.currentPhase);
    } finally {
      this.activeExecutions.delete(item.id);
      this.processedTotal++;
    }
  }

  /**
   * 承認後にキューアイテムを再開
   */
  async resumeAfterApproval(taskId: number): Promise<boolean> {
    const item = await this.queue.findByTaskId(taskId);
    if (!item || item.status !== 'waiting_approval') {
      return false;
    }

    await this.queue.updateStatus(item.id, 'queued', { currentPhase: 'plan_approved' });
    log.info(`[WorkflowRunner] Resumed task ${taskId} after approval`);

    // 次のポーリングでピックアップされる
    return true;
  }

  /**
   * ワークフローフェーズ遷移をActivityLogに記録し、SSEでブロードキャスト
   */
  private async logPhaseTransition(
    taskId: number,
    previousPhase: string,
    newPhase: string,
  ): Promise<void> {
    const phaseLabels: Record<string, string> = {
      draft: '初期化',
      research_done: '調査完了',
      plan_created: '計画作成',
      plan_approved: '計画承認',
      in_progress: '実装中',
      completed: '完了',
      advancing: '次フェーズへ進行中',
    };

    try {
      await prisma.activityLog.create({
        data: {
          taskId,
          action: 'workflow_phase_transition',
          metadata: JSON.stringify({
            previousPhase,
            newPhase,
            previousLabel: phaseLabels[previousPhase] || previousPhase,
            newLabel: phaseLabels[newPhase] || newPhase,
            timestamp: new Date().toISOString(),
          }),
          createdAt: new Date(),
        },
      });

      // SSE経由でフロントエンドにフェーズ遷移を通知
      realtimeService.broadcast('orchestra', 'phase_transition', {
        taskId,
        previousPhase,
        newPhase,
        previousLabel: phaseLabels[previousPhase] || previousPhase,
        newLabel: phaseLabels[newPhase] || newPhase,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      log.warn({ err: error }, `[WorkflowRunner] Failed to log phase transition for task ${taskId}`);
    }
  }

  /**
   * SSE経由でステータスブロードキャスト
   */
  private broadcastStatus(event: string): void {
    try {
      realtimeService.broadcast('orchestra', event, {
        runner: this.getStatus(),
        timestamp: new Date().toISOString(),
      });
    } catch {
      // SSEが利用不可でもランナーは動作を続ける
    }
  }

  /**
   * SSE経由でアイテム更新をブロードキャスト
   */
  private broadcastItemUpdate(
    itemId: number,
    taskId: number,
    event: string,
    phase: string,
  ): void {
    try {
      realtimeService.broadcast('orchestra', 'item_update', {
        event,
        itemId,
        taskId,
        phase,
        activeCount: this.activeExecutions.size,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // SSEが利用不可でもランナーは動作を続ける
    }
  }
}
