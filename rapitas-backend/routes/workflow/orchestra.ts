/**
 * Orchestra Routes
 * AIオーケストラの制御・状態管理APIエンドポイント
 */
import { Elysia } from 'elysia';
import { prisma } from '../../config';
import { ValidationError, parseId } from '../../middleware/error-handler';
import { AIOrchestra } from '../../services/workflow/ai-orchestra';
import { WorkflowQueueService } from '../../services/workflow/workflow-queue';
import { WorkflowRunner } from '../../services/workflow/workflow-runner';
import { createLogger } from '../../config/logger';
import { realtimeService } from '../../services/realtime-service';

const log = createLogger('routes:orchestra');

export const orchestraRoutes = new Elysia()

  /**
   * POST /workflow/orchestra/start - オーケストレーション開始
   */
  .post('/workflow/orchestra/start', async ({ body }) => {
    const { taskIds, maxConcurrency, autoStart, priorityStrategy } = body as {
      taskIds: number[];
      maxConcurrency?: number;
      autoStart?: boolean;
      priorityStrategy?: 'fifo' | 'priority' | 'dependency_aware';
    };

    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      throw new ValidationError('taskIds must be a non-empty array of task IDs');
    }

    const orchestra = AIOrchestra.getInstance();
    const result = await orchestra.conductWorkflow(taskIds, {
      maxConcurrency,
      autoStart,
      priorityStrategy,
    });

    return result;
  })

  /**
   * POST /workflow/orchestra/stop - オーケストレーション停止
   */
  .post('/workflow/orchestra/stop', async () => {
    const orchestra = AIOrchestra.getInstance();
    await orchestra.stop();
    return { success: true, message: 'Orchestra stopped' };
  })

  /**
   * POST /workflow/orchestra/resume - オーケストレーション再開
   */
  .post('/workflow/orchestra/resume', async () => {
    const orchestra = AIOrchestra.getInstance();
    const resumed = await orchestra.resume();
    return { success: resumed, message: resumed ? 'Orchestra resumed' : 'No session to resume' };
  })

  /**
   * GET /workflow/orchestra/status - オーケストラ状態取得
   */
  .get('/workflow/orchestra/status', async () => {
    const orchestra = AIOrchestra.getInstance();
    return orchestra.getState();
  })

  /**
   * GET /workflow/orchestra/queue - キュー状態取得
   */
  .get('/workflow/orchestra/queue', async ({ query }) => {
    const sessionId = query.sessionId ? parseInt(query.sessionId as string) : undefined;
    const queueService = WorkflowQueueService.getInstance();
    const state = await queueService.getQueueState(sessionId);

    // タスク情報を付与
    const allItems = [
      ...state.queued,
      ...state.running,
      ...state.waitingApproval,
      ...state.completed,
      ...state.failed,
    ];

    const taskIds = allItems.map((i) => i.taskId);
    const tasks = await prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        workflowStatus: true,
        workflowMode: true,
        theme: { select: { id: true, name: true, color: true } },
      },
    });

    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    const enrichItem = (item: typeof allItems[0]) => ({
      ...item,
      task: taskMap.get(item.taskId) || null,
    });

    return {
      queued: state.queued.map(enrichItem),
      running: state.running.map(enrichItem),
      waitingApproval: state.waitingApproval.map(enrichItem),
      completed: state.completed.map(enrichItem),
      failed: state.failed.map(enrichItem),
      totalItems: state.totalItems,
      maxConcurrency: state.maxConcurrency,
    };
  })

  /**
   * POST /workflow/orchestra/enqueue - 単一タスクのキュー追加
   */
  .post('/workflow/orchestra/enqueue', async ({ body }) => {
    const { taskId, priority, dependencies } = body as {
      taskId: number;
      priority?: number;
      dependencies?: number[];
    };

    if (!taskId) {
      throw new ValidationError('taskId is required');
    }

    const orchestra = AIOrchestra.getInstance();
    return orchestra.enqueueTask({ taskId, priority, dependencies });
  })

  /**
   * DELETE /workflow/orchestra/queue/:itemId - キューアイテム削除
   */
  .delete('/workflow/orchestra/queue/:itemId', async ({ params }) => {
    const itemId = parseId(params.itemId);
    const queueService = WorkflowQueueService.getInstance();
    const item = await queueService.cancel(itemId);
    return { success: true, item };
  })

  /**
   * PUT /workflow/orchestra/queue/:itemId/priority - 優先度変更
   */
  .put('/workflow/orchestra/queue/:itemId/priority', async ({ params, body }) => {
    const itemId = parseId(params.itemId);
    const { priority } = body as { priority: number };

    if (priority === undefined || priority < 0 || priority > 100) {
      throw new ValidationError('priority must be between 0 and 100');
    }

    const queueService = WorkflowQueueService.getInstance();
    const item = await queueService.updatePriority(itemId, priority);
    return { success: true, item };
  })

  /**
   * GET /workflow/orchestra/sessions - セッション履歴取得
   */
  .get('/workflow/orchestra/sessions', async ({ query }) => {
    const limit = Math.min(parseInt((query.limit as string) || '10'), 50);
    const sessions = await prisma.orchestraSession.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        queueItems: {
          select: {
            id: true,
            taskId: true,
            status: true,
            currentPhase: true,
            priority: true,
          },
        },
      },
    });

    return sessions.map((s) => ({
      ...s,
      metadata: JSON.parse(s.metadata || '{}'),
    }));
  })

  /**
   * GET /workflow/orchestra/events - SSEエンドポイント
   */
  .get('/workflow/orchestra/events', () => {
    // 初回ダミー登録（後でReadableStream内で再登録）
    const tempClientId = realtimeService.registerClient(
      { write: () => {} },
      ['orchestra'],
    );

    let activeClientId = tempClientId;

    return new Response(
      new ReadableStream({
        start(controller) {
          const client = {
            write: (data: string) => {
              try {
                controller.enqueue(new TextEncoder().encode(data));
              } catch {
                realtimeService.removeClient(activeClientId);
              }
            },
          };

          // ダミーを削除して本物を登録
          realtimeService.removeClient(tempClientId);
          activeClientId = realtimeService.registerClient(client, ['orchestra']);
          realtimeService.registerStreamController(activeClientId, controller);
        },
        cancel() {
          realtimeService.removeClient(activeClientId);
          realtimeService.removeStreamController(activeClientId);
          log.info(`[Orchestra SSE] Client ${activeClientId} disconnected`);
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      },
    );
  })

  /**
   * POST /workflow/orchestra/plan-approved/:taskId - plan承認通知（ワークフロールーターとの連携）
   */
  .post('/workflow/orchestra/plan-approved/:taskId', async ({ params }) => {
    const taskId = parseId(params.taskId);
    const orchestra = AIOrchestra.getInstance();
    await orchestra.handlePlanApproved(taskId);
    return { success: true, message: `Task ${taskId} plan approval handled` };
  })

  /**
   * GET /workflow/orchestra/runner - ランナー状態取得
   */
  .get('/workflow/orchestra/runner', async () => {
    const runner = WorkflowRunner.getInstance();
    return runner.getStatus();
  });
