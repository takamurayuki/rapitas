/**
 * 並列実行APIルート
 * サブタスクの依存関係分析と並列実行のためのAPIエンドポイント
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";
import { createLogger } from "../../config/logger";

const log = createLogger("routes:parallel-execution");
import {
  createParallelExecutor,
  createDependencyAnalyzer,
  type DependencyAnalysisInput,
  type TaskPriority,
  type ParallelExecutionConfig,
} from "../../services/parallel-execution";
import {
  SSEStreamController,
  getUserFriendlyErrorMessage,
} from "../../services/sse-utils";

// パラレル実行オーケストレーターのシングルトンインスタンス
let parallelExecutor: ReturnType<typeof createParallelExecutor> | null = null;

function getParallelExecutor() {
  if (!parallelExecutor) {
    parallelExecutor = createParallelExecutor(prisma);
  }
  return parallelExecutor;
}

/**
 * タスクからDependencyAnalysisInputを生成
 */
async function buildAnalysisInput(taskId: number): Promise<DependencyAnalysisInput> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      subtasks: {
        include: {
          prompts: true,
        },
      },
      prompts: true,
    },
  });

  if (!task) {
    throw new Error(`タスクが見つかりません: ${taskId}`);
  }

  // サブタスクの情報を変換
  const subtasks = task.subtasks.map((subtask: typeof task.subtasks[number]) => {
    // 説明とプロンプトからファイルパスを抽出
    const files: string[] = [];

    // プロンプトからファイル情報を抽出
    for (const prompt of subtask.prompts) {
      files.push(...extractFilePaths(prompt.optimizedPrompt));
      files.push(...extractFilePaths(prompt.originalDescription));
    }
    files.push(...extractFilePaths(subtask.description));

    return {
      id: subtask.id,
      title: subtask.title,
      description: subtask.description || undefined,
      priority: (subtask.priority || 'medium') as TaskPriority,
      estimatedHours: subtask.estimatedHours || 1,
      files: [...new Set(files)],
      explicitDependencies: [], // 明示的な依存関係（将来的にDBから取得）
    };
  });

  return {
    parentTaskId: taskId,
    subtasks,
  };
}

/**
 * ファイルパスを抽出するヘルパー関数
 */
function extractFilePaths(text: string | null | undefined): string[] {
  if (!text) return [];

  const patterns = [
    /(?:^|\s|["'`])([\/][\w\-\.\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    /(?:^|\s|["'`])([A-Za-z]:[\\\/][\w\-\.\\\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    /(?:^|\s|["'`])(\.{0,2}[\/\\][\w\-\.\/\\]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    /(?:^|\s|["'`])((?:src|lib|app|components|pages|features?|services?|utils?|hooks?|types?|api|routes?)[\w\-\.\/\\]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
  ];

  const files = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const filePath = match[1]
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .toLowerCase();
      if (/\.[a-zA-Z]{1,10}$/.test(filePath)) {
        files.add(filePath);
      }
    }
  }
  return Array.from(files);
}

export const parallelExecutionRoutes = new Elysia({ prefix: "/parallel" })
  /**
   * 依存関係を分析してツリーマップを取得
   */
  .get(
    "/tasks/:id/analyze",
    async (context) => {
      const { params  } = context;
      try {
        const taskId = parseInt(params.id);
        const input = await buildAnalysisInput(taskId);

        const analyzer = createDependencyAnalyzer();
        const result = analyzer.analyze(input);

        // ツリーマップをシリアライズ可能な形式に変換
        const nodes = Array.from(result.treeMap.nodes.entries()).map(([_id, node]) => ({
          ...node,
        }));

        return {
          success: true,
          data: {
            parentTaskId: taskId,
            subtaskCount: input.subtasks.length,
            nodes,
            edges: result.treeMap.edges,
            criticalPath: result.treeMap.criticalPath,
            parallelGroups: result.treeMap.parallelGroups,
            maxDepth: result.treeMap.maxDepth,
            plan: {
              id: result.plan.id,
              executionOrder: result.plan.executionOrder,
              estimatedTotalDuration: result.plan.estimatedTotalDuration,
              estimatedSequentialDuration: result.plan.estimatedSequentialDuration,
              parallelEfficiency: result.plan.parallelEfficiency,
              maxConcurrency: result.plan.maxConcurrency,
              resourceConstraints: result.plan.resourceConstraints,
            },
            recommendations: result.recommendations,
            warnings: result.warnings,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  /**
   * SSEストリームで依存関係分析
   */
  .get(
    "/tasks/:id/analyze/stream",
    async (context) => {
      const { params, set  } = context;
      const taskId = parseInt(params.id);

      set.headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      };

      const sseController = new SSEStreamController({
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 5000,
        backoffMultiplier: 2,
      });

      const stream = sseController.createStream();

      (async () => {
        try {
          sseController.sendStart({ taskId });
          sseController.sendProgress(10, "タスク情報を取得中...");

          const input = await buildAnalysisInput(taskId);
          sseController.sendProgress(30, "依存関係を分析中...");

          const analyzer = createDependencyAnalyzer();
          const result = analyzer.analyze(input);
          sseController.sendProgress(70, "ツリーマップを生成中...");

          const nodes = Array.from(result.treeMap.nodes.entries()).map(([_id, node]) => ({
            ...node,
          }));

          sseController.sendProgress(90, "結果をまとめています...");

          sseController.sendData({
            parentTaskId: taskId,
            subtaskCount: input.subtasks.length,
            nodes,
            edges: result.treeMap.edges,
            criticalPath: result.treeMap.criticalPath,
            parallelGroups: result.treeMap.parallelGroups,
            maxDepth: result.treeMap.maxDepth,
            plan: {
              id: result.plan.id,
              executionOrder: result.plan.executionOrder,
              estimatedTotalDuration: result.plan.estimatedTotalDuration,
              estimatedSequentialDuration: result.plan.estimatedSequentialDuration,
              parallelEfficiency: result.plan.parallelEfficiency,
              maxConcurrency: result.plan.maxConcurrency,
            },
            recommendations: result.recommendations,
            warnings: result.warnings,
          });

          sseController.sendComplete({ success: true });
        } catch (error) {
          const errorMessage = getUserFriendlyErrorMessage(error);
          sseController.sendError(errorMessage, {
            originalError: error instanceof Error ? error.message : String(error),
          });
        } finally {
          sseController.close();
        }
      })();

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  /**
   * 並列実行セッションを開始
   */
  .post(
    "/tasks/:id/execute",
    async (context) => {
      const { params, body  } = context;
      try {
        const taskId = parseInt(params.id);
        const config = (body as Record<string, unknown>).config as Partial<ParallelExecutionConfig> | undefined;

        // タスク情報を取得
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: {
            theme: true,
            subtasks: {
              include: {
                prompts: true,
              },
            },
          },
        });

        if (!task) {
          return { success: false, error: "タスクが見つかりません" };
        }

        if (task.subtasks.length === 0) {
          return { success: false, error: "サブタスクがありません" };
        }

        // 依存関係を分析
        const input = await buildAnalysisInput(taskId);
        const analyzer = createDependencyAnalyzer();
        const analysisResult = analyzer.analyze({
          ...input,
          config,
        });

        // DeveloperModeConfigを確認/作成
        let devConfig = await prisma.developerModeConfig.findUnique({
          where: { taskId },
        });

        if (!devConfig) {
          devConfig = await prisma.developerModeConfig.create({
            data: {
              taskId,
              isEnabled: true,
            },
          });
        }

        // AgentSessionを作成
        const agentSession = await prisma.agentSession.create({
          data: {
            configId: devConfig.id,
            status: "running",
            startedAt: new Date(),
            metadata: JSON.stringify({
              type: "parallel_execution",
              planId: analysisResult.plan.id,
              maxConcurrency: config?.maxConcurrentAgents || 3,
            }),
          },
        });

        // 並列実行を開始
        const executor = getParallelExecutor();
        const session = await executor.startSession(
          taskId,
          analysisResult.plan,
          analysisResult.treeMap.nodes,
          task.theme?.workingDirectory || process.cwd()
        );

        return {
          success: true,
          data: {
            sessionId: session.sessionId,
            agentSessionId: agentSession.id,
            plan: {
              id: analysisResult.plan.id,
              groups: analysisResult.plan.groups.length,
              maxConcurrency: analysisResult.plan.maxConcurrency,
              estimatedTotalDuration: analysisResult.plan.estimatedTotalDuration,
              parallelEfficiency: analysisResult.plan.parallelEfficiency,
            },
            status: session.status,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ errorMessage }, "[ParallelExecution] Error starting session");
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        config: t.Optional(
          t.Object({
            maxConcurrentAgents: t.Optional(t.Number()),
            questionTimeoutSeconds: t.Optional(t.Number()),
            taskTimeoutSeconds: t.Optional(t.Number()),
            retryOnFailure: t.Optional(t.Boolean()),
            maxRetries: t.Optional(t.Number()),
            logSharing: t.Optional(t.Boolean()),
            coordinationEnabled: t.Optional(t.Boolean()),
          })
        ),
      }),
    }
  )

  /**
   * 並列実行セッションの状態を取得
   */
  .get(
    "/sessions/:sessionId/status",
    async (context) => {
      const { params  } = context;
      try {
        const executor = getParallelExecutor();
        const status = executor.getSessionStatus(params.sessionId);

        if (!status) {
          return { success: false, error: "セッションが見つかりません" };
        }

        return {
          success: true,
          data: status,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
    }
  )

  /**
   * 並列実行セッションを停止
   */
  .post(
    "/sessions/:sessionId/stop",
    async (context) => {
      const { params  } = context;
      try {
        const executor = getParallelExecutor();
        await executor.stopSession(params.sessionId);

        return {
          success: true,
          message: "セッションを停止しました",
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
    }
  )

  /**
   * セッションの実行ログを取得
   */
  .get(
    "/sessions/:sessionId/logs",
    async (context) => {
      const { params, query  } = context;
      try {
        const executor = getParallelExecutor();
        const logs = executor.getLogs({
          sessionId: params.sessionId,
          taskId: query.taskId ? parseInt(query.taskId) : undefined,
          level: query.level ? [query.level as "info" | "warn" | "error" | "debug"] : undefined,
          limit: query.limit ? parseInt(query.limit) : 100,
        });

        return {
          success: true,
          data: logs,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
      query: t.Object({
        taskId: t.Optional(t.String()),
        level: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  /**
   * SSEストリームで実行ログをリアルタイムに取得
   */
  .get(
    "/sessions/:sessionId/logs/stream",
    async (context) => {
      const { params, set  } = context;
      set.headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      };

      const sseController = new SSEStreamController({
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 5000,
        backoffMultiplier: 2,
      });

      const stream = sseController.createStream();
      const executor = getParallelExecutor();

      const eventHandler = (event: { type: string; sessionId: string; taskId?: number; level?: number; data?: unknown; timestamp: Date }) => {
        sseController.sendData({
          type: event.type,
          sessionId: event.sessionId,
          taskId: event.taskId,
          level: event.level,
          data: event.data,
          timestamp: event.timestamp.toISOString(),
        });

        // セッション完了時にストリームを閉じる
        if (event.type === "session_completed" || event.type === "session_failed") {
          sseController.sendComplete({ status: event.type });
          sseController.close();
        }
      };

      executor.addEventListener(eventHandler);

      // ReadableStreamをラップしてクリーンアップハンドラを追加
      const wrappedStream = new ReadableStream({
        start(controller) {
          const reader = stream.getReader();
          function pump(): void {
            reader.read().then(({ done, value }) => {
              if (done) {
                controller.close();
                executor.removeEventListener(eventHandler);
                return;
              }
              controller.enqueue(value);
              pump();
            }).catch(() => {
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
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
    }
  );
