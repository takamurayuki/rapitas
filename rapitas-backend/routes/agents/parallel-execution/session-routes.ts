/**
 * SessionRoutes
 *
 * Elysia route handlers for parallel execution session management:
 * - GET  /parallel/sessions/:sessionId/status
 * - POST /parallel/sessions/:sessionId/stop
 * - GET  /parallel/sessions/:sessionId/logs
 * - GET  /parallel/sessions/:sessionId/logs/stream
 * - GET  /parallel/sessions/:sessionId/safety-report
 * - POST /parallel/sessions/:sessionId/trial-merge
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../../config';
import { MergeValidator } from '../../../services/parallel-execution';
import { SSEStreamController } from '../../../services/communication/sse-utils';
import { getSafetyReportFromExecutor, getSessionFromExecutor } from './pr-helpers';
import type { getParallelExecutor } from './executor-singleton';

const log = createLogger('routes:parallel-execution:sessions');

/**
 * Build session routes that require the parallel executor instance.
 *
 * @param getExecutor - Factory function returning the singleton executor / シングルトンエクゼキューター取得関数
 * @returns Elysia instance with session routes / セッションルートを持つElysiaインスタンス
 */
export function buildSessionRoutes(
  getExecutor: typeof getParallelExecutor,
): Elysia {
  return new Elysia()
    /**
     * Get the status of a parallel execution session.
     */
    .get(
      '/sessions/:sessionId/status',
      async (context) => {
        const { params } = context;
        try {
          const executor = getExecutor();
          const status = executor.getSessionStatus(params.sessionId);

          if (!status) {
            return { success: false, error: 'セッションが見つかりません' };
          }

          return { success: true, data: status };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return { success: false, error: errorMessage };
        }
      },
      {
        params: t.Object({ sessionId: t.String() }),
      },
    )

    /**
     * Stop a parallel execution session.
     */
    .post(
      '/sessions/:sessionId/stop',
      async (context) => {
        const { params } = context;
        try {
          const executor = getExecutor();
          await executor.stopSession(params.sessionId);

          return { success: true, message: 'セッションを停止しました' };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return { success: false, error: errorMessage };
        }
      },
      {
        params: t.Object({ sessionId: t.String() }),
      },
    )

    /**
     * Get execution logs for a session.
     */
    .get(
      '/sessions/:sessionId/logs',
      async (context) => {
        const { params, query } = context;
        try {
          const executor = getExecutor();
          const logs = executor.getLogs({
            sessionId: params.sessionId,
            taskId: query.taskId ? parseInt(query.taskId) : undefined,
            level: query.level
              ? [query.level as 'info' | 'warn' | 'error' | 'debug']
              : undefined,
            limit: query.limit ? parseInt(query.limit) : 100,
          });

          return { success: true, data: logs };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return { success: false, error: errorMessage };
        }
      },
      {
        params: t.Object({ sessionId: t.String() }),
        query: t.Object({
          taskId: t.Optional(t.String()),
          level: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
      },
    )

    /**
     * Stream execution logs in real-time via SSE.
     */
    .get(
      '/sessions/:sessionId/logs/stream',
      async (context) => {
        const { params, set } = context;
        set.headers = {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        };

        const sseController = new SSEStreamController({
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 5000,
          backoffMultiplier: 2,
        });

        const stream = sseController.createStream();
        const executor = getExecutor();

        const eventHandler = (event: {
          type: string;
          sessionId: string;
          taskId?: number;
          level?: number;
          data?: unknown;
          timestamp: Date;
        }) => {
          sseController.sendData({
            type: event.type,
            sessionId: event.sessionId,
            taskId: event.taskId,
            level: event.level,
            data: event.data,
            timestamp: event.timestamp.toISOString(),
          });

          if (event.type === 'session_completed' || event.type === 'session_failed') {
            sseController.sendComplete({ status: event.type });
            sseController.close();
          }
        };

        executor.addEventListener(eventHandler);

        const wrappedStream = new ReadableStream({
          start(controller) {
            const reader = stream.getReader();
            function pump(): void {
              reader
                .read()
                .then(({ done, value }) => {
                  if (done) {
                    controller.close();
                    executor.removeEventListener(eventHandler);
                    return;
                  }
                  controller.enqueue(value);
                  pump();
                })
                .catch((err) => {
                  log.warn({ err }, 'SSE stream read error, closing controller');
                  controller.close();
                  executor.removeEventListener(eventHandler);
                });
            }
            pump();
          },
          cancel() {
            executor.removeEventListener(eventHandler);
          },
        });

        return new Response(wrappedStream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      },
      {
        params: t.Object({ sessionId: t.String() }),
      },
    )

    /**
     * Retrieve the safety report for a completed session.
     */
    .get(
      '/sessions/:sessionId/safety-report',
      async (context) => {
        const { params } = context;
        try {
          const executor = getExecutor();
          const status = executor.getSessionStatus(params.sessionId);
          if (!status) {
            return { success: false, error: 'セッションが見つかりません' };
          }

          // NOTE: Retrieve from coordinator shared data via a dedicated method on the executor
          const safetyReport = getSafetyReportFromExecutor(executor, params.sessionId);
          if (!safetyReport) {
            return {
              success: false,
              error: 'セーフティレポートがまだ生成されていません',
            };
          }

          return { success: true, data: safetyReport };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return { success: false, error: errorMessage };
        }
      },
      {
        params: t.Object({ sessionId: t.String() }),
      },
    )

    /**
     * Manually trigger a trial merge for a session (can be run before session completion).
     */
    .post(
      '/sessions/:sessionId/trial-merge',
      async (context) => {
        const { params } = context;
        try {
          const executor = getExecutor();
          const status = executor.getSessionStatus(params.sessionId);

          if (!status) {
            return { success: false, error: 'セッションが見つかりません' };
          }

          const sessionData = getSessionFromExecutor(executor, params.sessionId);
          if (!sessionData) {
            return { success: false, error: 'セッションデータが見つかりません' };
          }

          const taskBranches = Array.from(sessionData.taskBranches.entries()).map(
            ([taskId, branchName]) => ({ taskId, branchName }),
          );

          if (taskBranches.length < 2) {
            return {
              success: false,
              error: 'トライアルマージには2つ以上のブランチが必要です',
            };
          }

          const validator = new MergeValidator();
          const report = await validator.generateSafetyReport(
            params.sessionId,
            sessionData.workingDirectory,
            taskBranches,
            'develop',
            [],
          );

          return { success: true, data: report };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.error({ errorMessage }, '[ParallelExecution] Trial merge failed');
          return { success: false, error: errorMessage };
        }
      },
      {
        params: t.Object({ sessionId: t.String() }),
      },
    );
}
