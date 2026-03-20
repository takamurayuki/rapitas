/**
 * ParallelExecutionRoutes
 *
 * API endpoints for subtask dependency analysis and parallel execution.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger, getProjectRoot } from '../../config';

const log = createLogger('routes:parallel-execution');
import {
  createParallelExecutor,
  createDependencyAnalyzer,
  MergeValidator,
  type DependencyAnalysisInput,
  type TaskPriority,
  type ParallelExecutionConfig,
  type SafetyReport,
} from '../../services/parallel-execution';
import { SSEStreamController, getUserFriendlyErrorMessage } from '../../services/sse-utils';
import { AIOrchestra } from '../../services/workflow/ai-orchestra';
import { GitOperations } from '../../services/agents/orchestrator/git-operations';
import { reviewBranchDiff, postReviewToPR } from '../../services/ai-code-review';
import { sendWebhookNotification } from '../../services/webhook-notification-service';
import { pollDeploymentStatus } from '../../services/preview-deploy-service';
import { readFile } from 'fs/promises';
import { join } from 'path';

let parallelExecutor: ReturnType<typeof createParallelExecutor> | null = null;

function getParallelExecutor() {
  if (!parallelExecutor) {
    parallelExecutor = createParallelExecutor(prisma);
  }
  return parallelExecutor;
}

/**
 * Build a DependencyAnalysisInput from a task and its subtasks.
 *
 * @param taskId - Task ID to analyze / 分析対象のタスクID
 * @returns DependencyAnalysisInput for the analyzer / アナライザー用の依存関係分析入力
 * @throws {Error} When the task is not found / タスクが見つからない場合
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
    throw new Error(`Task not found: ${taskId}`);
  }

  const subtasks = task.subtasks.map((subtask: (typeof task.subtasks)[number]) => {
    const files: string[] = [];

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
      // TODO: Load explicit dependencies from DB once the dependency table is implemented.
      explicitDependencies: [],
    };
  });

  return {
    parentTaskId: taskId,
    subtasks,
  };
}

/**
 * Extract file paths from text content.
 *
 * @param text - Source text to scan / スキャン対象のテキスト
 * @returns Array of unique file paths found / 検出されたユニークなファイルパスの配列
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
      const filePath = match[1].replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
      if (/\.[a-zA-Z]{1,10}$/.test(filePath)) {
        files.add(filePath);
      }
    }
  }
  return Array.from(files);
}

export const parallelExecutionRoutes = new Elysia({ prefix: '/parallel' })
  /**
   * Analyze dependencies and retrieve a tree map.
   */
  .get(
    '/tasks/:id/analyze',
    async (context) => {
      const { params } = context;
      try {
        const taskId = parseInt(params.id);
        const input = await buildAnalysisInput(taskId);

        const analyzer = createDependencyAnalyzer();
        const result = analyzer.analyze(input);

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
    },
  )

  /**
   * Analyze dependencies via SSE stream.
   */
  .get(
    '/tasks/:id/analyze/stream',
    async (context) => {
      const { params, set } = context;
      const taskId = parseInt(params.id);

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

      (async () => {
        try {
          sseController.sendStart({ taskId });
          sseController.sendProgress(10, 'Fetching task information...');

          const input = await buildAnalysisInput(taskId);
          sseController.sendProgress(30, 'Analyzing dependencies...');

          const analyzer = createDependencyAnalyzer();
          const result = analyzer.analyze(input);
          sseController.sendProgress(70, 'Generating tree map...');

          const nodes = Array.from(result.treeMap.nodes.entries()).map(([_id, node]) => ({
            ...node,
          }));

          sseController.sendProgress(90, 'Compiling results...');

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
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  /**
   * Analyze cross-task dependency graph for a theme or set of tasks.
   * Returns nodes and edges suitable for visualization (React Flow, D3, etc.).
   */
  .get(
    '/dependency-graph',
    async (context) => {
      const { query } = context;
      try {
        const themeId = query.themeId ? parseInt(query.themeId) : undefined;
        const status = query.status || undefined;

        const where: Record<string, unknown> = { parentId: null };
        if (themeId) where.themeId = themeId;
        if (status) where.status = status;

        const tasks = await prisma.task.findMany({
          where,
          include: {
            subtasks: { select: { id: true, title: true, status: true } },
            prompts: { select: { optimizedPrompt: true, originalDescription: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: parseInt(query.limit || '50'),
        });

        if (tasks.length === 0) {
          return { success: true, data: { nodes: [], edges: [], groups: [] } };
        }

        type SubtaskEntry = {
          id: number;
          title: string;
          description?: string;
          priority: TaskPriority;
          estimatedHours?: number;
          files?: string[];
          explicitDependencies?: number[];
        };

        const subtaskList: SubtaskEntry[] = [];
        for (const t of tasks) {
          if (t.subtasks.length > 0) {
            for (const s of t.subtasks) {
              subtaskList.push({ id: s.id, title: s.title, priority: 'medium' });
            }
          } else {
            const files = extractFilePaths(t.description);
            for (const p of t.prompts) {
              files.push(...extractFilePaths(p.optimizedPrompt));
              files.push(...extractFilePaths(p.originalDescription));
            }
            subtaskList.push({
              id: t.id,
              title: t.title,
              description: t.description || undefined,
              priority: (t.priority || 'medium') as TaskPriority,
              estimatedHours: t.estimatedHours || 1,
              files: [...new Set(files)],
            });
          }
        }

        if (subtaskList.length < 2) {
          const n = subtaskList[0];
          return {
            success: true,
            data: {
              nodes: n
                ? [
                    {
                      id: n.id,
                      title: n.title,
                      depth: 0,
                      independenceScore: 100,
                      parallelizability: 100,
                      status: 'pending',
                      files: n.files || [],
                    },
                  ]
                : [],
              edges: [],
              groups: [],
            },
          };
        }

        // Deduplicate by ID
        const uniqueMap = new Map<number, SubtaskEntry>();
        for (const s of subtaskList) uniqueMap.set(s.id, s);

        const analyzer = createDependencyAnalyzer();
        const result = analyzer.analyze({
          parentTaskId: themeId || 0,
          subtasks: [...uniqueMap.values()],
        });

        const nodes = Array.from(result.treeMap.nodes.entries()).map(([, node]) => ({
          id: node.id,
          title: node.title,
          depth: node.depth,
          independenceScore: node.independenceScore,
          parallelizability: node.parallelizability,
          status: node.status,
          files: node.files,
        }));

        return {
          success: true,
          data: {
            nodes,
            edges: result.treeMap.edges,
            criticalPath: result.treeMap.criticalPath,
            groups: result.treeMap.parallelGroups,
            maxDepth: result.treeMap.maxDepth,
            plan: {
              parallelEfficiency: result.plan.parallelEfficiency,
              estimatedTotalDuration: result.plan.estimatedTotalDuration,
              maxConcurrency: result.plan.maxConcurrency,
            },
            recommendations: result.recommendations,
            warnings: result.warnings,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ errorMessage }, '[DependencyGraph] Analysis failed');
        return { success: false, error: errorMessage };
      }
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String()),
        status: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  )

  /**
   * Start a parallel execution session.
   */
  .post(
    '/tasks/:id/execute',
    async (context) => {
      const { params, body } = context;
      try {
        const taskId = parseInt(params.id);
        const config = (body as Record<string, unknown>).config as
          | Partial<ParallelExecutionConfig>
          | undefined;

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
          return { success: false, error: 'タスクが見つかりません' };
        }

        if (task.subtasks.length === 0) {
          return { success: false, error: 'サブタスクがありません' };
        }

        const input = await buildAnalysisInput(taskId);
        const analyzer = createDependencyAnalyzer();
        const analysisResult = analyzer.analyze({
          ...input,
          config,
        });

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

        const agentSession = await prisma.agentSession.create({
          data: {
            configId: devConfig.id,
            status: 'running',
            startedAt: new Date(),
            metadata: JSON.stringify({
              type: 'parallel_execution',
              planId: analysisResult.plan.id,
              maxConcurrency: config?.maxConcurrentAgents || 3,
            }),
          },
        });

        const useWorkflow = (body as Record<string, unknown>).useWorkflow !== false;
        const subtaskIds = task.subtasks.map((s) => s.id);

        if (useWorkflow) {
          const userSettings = await prisma.userSettings.findFirst();
          const autoApprove =
            ((userSettings as Record<string, unknown> | null)?.autoApproveSubtaskPlan as
              | boolean
              | undefined) ?? true;

          await prisma.task.updateMany({
            where: { id: { in: subtaskIds } },
            data: {
              workflowMode: 'lightweight',
              workflowStatus: 'draft',
              autoApprovePlan: autoApprove,
            },
          });

          const orchestra = AIOrchestra.getInstance();
          const result = await orchestra.conductWorkflow(subtaskIds, {
            maxConcurrency: config?.maxConcurrentAgents || 3,
            priorityStrategy: 'dependency_aware',
          });

          log.info(
            { taskId, sessionId: result.sessionId, enqueuedTasks: result.enqueuedTasks },
            '[ParallelExecution] Started workflow-based execution',
          );

          return {
            success: true,
            data: {
              sessionId: result.sessionId,
              agentSessionId: agentSession.id,
              orchestraSessionId: result.sessionId,
              plan: {
                id: analysisResult.plan.id,
                groups: analysisResult.plan.groups.length,
                maxConcurrency: analysisResult.plan.maxConcurrency,
                estimatedTotalDuration: analysisResult.plan.estimatedTotalDuration,
                parallelEfficiency: analysisResult.plan.parallelEfficiency,
              },
              workflow: {
                enqueuedTasks: result.enqueuedTasks,
                skippedTasks: result.skippedTasks,
                errors: result.errors,
              },
              status: 'running',
            },
          };
        }

        // CRITICAL: Require explicit workingDirectory to prevent accidental modification when unset
        const workingDirectory = task.theme?.workingDirectory;
        if (!workingDirectory) {
          log.error(
            `[parallel-start] Task ${taskId} rejected: workingDirectory not configured for theme "${task.theme?.name || 'unknown'}".`,
          );
          return {
            success: false,
            error:
              'Task theme must have workingDirectory configured. Please set the working directory in theme settings to prevent accidental modification of rapitas source code.',
          };
        }

        log.info(
          `[parallel-start] Starting parallel session for task ${taskId} in working directory: ${workingDirectory}`,
        );
        log.info(
          `[parallel-start] Theme: ${task.theme?.name || 'none'}, ThemeID: ${task.theme?.id || 'none'}`,
        );

        const executor = getParallelExecutor();
        const session = await executor.startSession(
          taskId,
          analysisResult.plan,
          analysisResult.treeMap.nodes,
          workingDirectory,
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
        log.error({ errorMessage }, '[ParallelExecution] Error starting session');
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
          }),
        ),
        useWorkflow: t.Optional(t.Boolean()),
      }),
    },
  )

  /**
   * Get the status of a parallel execution session.
   */
  .get(
    '/sessions/:sessionId/status',
    async (context) => {
      const { params } = context;
      try {
        const executor = getParallelExecutor();
        const status = executor.getSessionStatus(params.sessionId);

        if (!status) {
          return { success: false, error: 'セッションが見つかりません' };
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
        const executor = getParallelExecutor();
        await executor.stopSession(params.sessionId);

        return {
          success: true,
          message: 'セッションを停止しました',
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
        const executor = getParallelExecutor();
        const logs = executor.getLogs({
          sessionId: params.sessionId,
          taskId: query.taskId ? parseInt(query.taskId) : undefined,
          level: query.level ? [query.level as 'info' | 'warn' | 'error' | 'debug'] : undefined,
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
      const executor = getParallelExecutor();

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
      params: t.Object({
        sessionId: t.String(),
      }),
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
        const executor = getParallelExecutor();
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

        return {
          success: true,
          data: safetyReport,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
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
        const executor = getParallelExecutor();
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

        return {
          success: true,
          data: report,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ errorMessage }, '[ParallelExecution] Trial merge failed');
        return { success: false, error: errorMessage };
      }
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
    },
  )

  /**
   * Create a PR for a completed task branch with implementation summary and AI code review.
   */
  .post(
    '/tasks/:id/create-pr',
    async (context) => {
      const { params, body } = context;
      try {
        const taskId = parseInt(params.id);
        const baseBranch = (body as Record<string, unknown>).baseBranch as string | undefined;

        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: {
            theme: true,
            parent: true,
            developerModeConfig: {
              include: {
                agentSessions: { orderBy: { lastActivityAt: 'desc' }, take: 1 },
              },
            },
          },
        });

        if (!task) return { success: false, error: 'タスクが見つかりません' };

        // CRITICAL: Require explicit workingDirectory to prevent accidental modification when unset
        const workingDirectory = task.theme?.workingDirectory;
        if (!workingDirectory) {
          log.error(
            `[create-pr] Task ${taskId} rejected: workingDirectory not configured for theme "${task.theme?.name || 'unknown'}".`,
          );
          return {
            success: false,
            error:
              'Task theme must have workingDirectory configured. Please set the working directory in theme settings.',
          };
        }

        const latestSession = task.developerModeConfig?.agentSessions?.[0];
        const branchName = latestSession?.branchName;

        if (!branchName) return { success: false, error: 'ブランチが見つかりません' };

        const prBody = await buildPRBody(taskId, task, workingDirectory);
        const gitOps = new GitOperations();
        const pushDir = latestSession?.worktreePath || workingDirectory;

        // Push branch to remote
        const { execSync } = await import('child_process');
        try {
          execSync(`git push -u origin ${branchName}`, {
            cwd: pushDir,
            encoding: 'utf8',
            timeout: 30000,
          });
        } catch {
          execSync(`git push -u origin ${branchName}`, {
            cwd: workingDirectory,
            encoding: 'utf8',
            timeout: 30000,
          });
        }

        const prResult = await gitOps.createPullRequest(
          pushDir,
          `[Task-${taskId}] ${task.title}`,
          prBody,
          baseBranch || 'develop',
        );

        if (!prResult.success) return { success: false, error: prResult.error };

        await prisma.task.update({
          where: { id: taskId },
          data: { githubPrId: prResult.prNumber },
        });

        // NOTE: Run AI code review and post to PR (fire-and-forget)
        void (async () => {
          try {
            const planContent = await readWorkflowFile(taskId, 'plan');
            const review = await reviewBranchDiff(
              pushDir,
              baseBranch || 'develop',
              planContent || undefined,
            );
            if (review.totalFindings > 0 && prResult.prNumber) {
              await postReviewToPR(pushDir, prResult.prNumber, review);
            }
          } catch (err) {
            log.warn({ err }, '[PR] AI code review failed (non-fatal)');
          }
        })();

        void sendWebhookNotification('pr_created', {
          taskId,
          taskTitle: task.title,
          message: `PR #${prResult.prNumber} created for「${task.title}」`,
          url: prResult.prUrl,
        });

        // NOTE: Poll for preview deployment URL in background (fire-and-forget)
        if (prResult.prNumber) {
          void pollDeploymentStatus(pushDir, prResult.prNumber).catch((err) => {
            log.debug({ err }, '[PR] Preview deploy polling failed (non-fatal)');
          });
        }

        log.info(`[PR] Created PR #${prResult.prNumber} for task ${taskId}: ${prResult.prUrl}`);

        return {
          success: true,
          data: { prUrl: prResult.prUrl, prNumber: prResult.prNumber, branchName },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ errorMessage }, '[PR] Failed to create PR');
        return { success: false, error: errorMessage };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ baseBranch: t.Optional(t.String()) }),
    },
  )

  /**
   * Approve and merge a task's PR, then update local develop.
   */
  .post(
    '/tasks/:id/approve-merge',
    async (context) => {
      const { params } = context;
      try {
        const taskId = parseInt(params.id);

        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: {
            theme: true,
            developerModeConfig: {
              include: {
                agentSessions: { orderBy: { lastActivityAt: 'desc' }, take: 1 },
              },
            },
          },
        });

        if (!task) return { success: false, error: 'タスクが見つかりません' };
        if (!task.githubPrId)
          return { success: false, error: 'PRが見つかりません。先にPRを作成してください。' };

        // CRITICAL: Require explicit workingDirectory to prevent accidental modification when unset
        const workingDirectory = task.theme?.workingDirectory;
        if (!workingDirectory) {
          log.error(
            `[approve-merge] Task ${taskId} rejected: workingDirectory not configured for theme "${task.theme?.name || 'unknown'}".`,
          );
          return {
            success: false,
            error:
              'Task theme must have workingDirectory configured. Please set the working directory in theme settings.',
          };
        }
        const gitOps = new GitOperations();

        const mergeResult = await gitOps.mergePullRequest(
          workingDirectory,
          task.githubPrId,
          1,
          'develop',
        );

        if (!mergeResult.success) return { success: false, error: mergeResult.error };

        await prisma.task.update({ where: { id: taskId }, data: { status: 'done' } });

        // Clean up worktree if still exists
        const latestSession = task.developerModeConfig?.agentSessions?.[0];
        if (latestSession?.worktreePath) {
          try {
            await gitOps.removeWorktree(workingDirectory, latestSession.worktreePath);
            await prisma.agentSession.update({
              where: { id: latestSession.id },
              data: { worktreePath: null },
            });
          } catch (cleanupErr) {
            log.warn({ err: cleanupErr }, '[Merge] Worktree cleanup failed (non-fatal)');
          }
        }

        void sendWebhookNotification('pr_merged', {
          taskId,
          taskTitle: task.title,
          message: `PR #${task.githubPrId} merged for「${task.title}」(${mergeResult.mergeStrategy})`,
        });

        log.info(`[Merge] Merged PR #${task.githubPrId} for task ${taskId}`);

        return {
          success: true,
          data: { prNumber: task.githubPrId, mergeStrategy: mergeResult.mergeStrategy },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ errorMessage }, '[Merge] Failed to merge PR');
        return { success: false, error: errorMessage };
      }
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )

  /**
   * Get PR status for a task.
   */
  .get(
    '/tasks/:id/pr-status',
    async (context) => {
      const { params } = context;
      try {
        const taskId = parseInt(params.id);
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { id: true, title: true, status: true, githubPrId: true },
        });

        if (!task) return { success: false, error: 'タスクが見つかりません' };

        let prInfo: Record<string, unknown> | null = null;
        if (task.githubPrId) {
          try {
            const { execSync } = await import('child_process');
            const ghPath =
              process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';
            const prJson = execSync(
              `${ghPath} pr view ${task.githubPrId} --json url,state,mergeable`,
              { cwd: getProjectRoot(), encoding: 'utf8', timeout: 10000 },
            );
            prInfo = JSON.parse(prJson);
          } catch {
            prInfo = null;
          }
        }

        return {
          success: true,
          data: {
            taskId: task.id,
            title: task.title,
            status: task.status,
            prNumber: task.githubPrId,
            prInfo,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    },
    {
      params: t.Object({ id: t.String() }),
    },
  );

/**
 * Build a rich PR body with implementation summary, plan comparison, and validation.
 *
 * @param taskId - Task ID / タスクID
 * @param task - Task record with relations / リレーション付きタスクレコード
 * @param workingDirectory - Repository root / リポジトリルート
 * @returns Formatted PR body markdown / フォーマット済みPRボディMarkdown
 */
async function buildPRBody(
  taskId: number,
  task: { title: string; description: string | null },
  workingDirectory: string,
): Promise<string> {
  const sections: string[] = [];

  sections.push(`## Summary\n\nTask #${taskId}: ${task.title}`);
  if (task.description) {
    sections.push(`### Description\n\n${task.description.slice(0, 500)}`);
  }

  const planContent = await readWorkflowFile(taskId, 'plan');
  const verifyContent = await readWorkflowFile(taskId, 'verify');

  if (planContent) {
    sections.push(
      `### Implementation Plan\n\n<details>\n<summary>Original Plan</summary>\n\n${planContent}\n\n</details>`,
    );
  }
  if (verifyContent) {
    sections.push(`### Verification Report\n\n${verifyContent}`);
  }

  try {
    const { execSync } = await import('child_process');
    const diffStat = execSync('git diff --stat develop...HEAD', {
      cwd: workingDirectory,
      encoding: 'utf8',
      timeout: 10000,
    }).trim();
    if (diffStat) {
      sections.push(`### Changed Files\n\n\`\`\`\n${diffStat}\n\`\`\``);
    }
  } catch {
    /* non-fatal */
  }

  if (planContent && verifyContent) {
    const deviation = analyzePlanDeviation(planContent, verifyContent);
    if (deviation) sections.push(`### Plan Deviation\n\n${deviation}`);
  }

  sections.push('---\n🤖 Generated by Rapitas AI Agent');
  return sections.join('\n\n');
}

/**
 * Read a workflow file for a task.
 */
async function readWorkflowFile(taskId: number, fileType: string): Promise<string | null> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { theme: { include: { category: true } } },
    });
    if (!task) return null;

    const categoryDir = task.theme?.categoryId ? String(task.theme.categoryId) : '0';
    const themeDir = task.themeId ? String(task.themeId) : '0';
    const filePath = join(
      process.cwd(),
      'tasks',
      categoryDir,
      themeDir,
      String(taskId),
      `${fileType}.md`,
    );
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Compare plan.md and verify.md to detect deviations.
 */
function analyzePlanDeviation(planContent: string, verifyContent: string): string | null {
  const planChecklist = planContent.match(/- \[[ xX]\].+/g) || [];
  const planFiles = extractMentionedFiles(planContent);
  const verifyFiles = extractMentionedFiles(verifyContent);

  const addedFiles = verifyFiles.filter((f) => !planFiles.includes(f));
  const removedFiles = planFiles.filter((f) => !verifyFiles.includes(f));

  const lines: string[] = [];
  if (addedFiles.length > 0) lines.push(`**Plan外の変更ファイル**: ${addedFiles.join(', ')}`);
  if (removedFiles.length > 0)
    lines.push(`**Planにあるが未変更のファイル**: ${removedFiles.join(', ')}`);

  const verifyChecklist = verifyContent.match(/- \[[ xX]\].+/g) || [];
  const completedCount = verifyChecklist.filter((item) => /\[[xX]\]/.test(item)).length;
  const totalPlanned = planChecklist.length;

  if (totalPlanned > 0) {
    const rate = Math.round((completedCount / totalPlanned) * 100);
    lines.push(`**Plan達成率**: ${completedCount}/${totalPlanned} (${rate}%)`);
  }

  if (lines.length <= 1 && addedFiles.length === 0 && removedFiles.length === 0) {
    lines.unshift('Planからの大きな逸脱はありません。');
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

function extractMentionedFiles(content: string): string[] {
  const matches = content.match(/[\w\-./]+\.[a-zA-Z]{1,10}/g) || [];
  return [...new Set(matches.filter((m) => m.includes('/') && !m.match(/^v?\d+\.\d+/)))];
}

/**
 * Retrieve safety report from executor's internal coordinator shared data.
 *
 * @param executor - Parallel executor instance / パラレルエクゼキューターインスタンス
 * @param sessionId - Session ID / セッションID
 * @returns Safety report or null / セーフティレポートまたはnull
 */
function getSafetyReportFromExecutor(
  executor: ReturnType<typeof createParallelExecutor>,
  sessionId: string,
): SafetyReport | null {
  // NOTE: Access coordinator via executor's prototype — typed as 'any' because
  // coordinator is private. A public accessor would be preferred long-term.
  // HACK(agent): Private field access needed until a public getSafetyReport() is added.
  const internal = executor as unknown as Record<string, unknown>;
  const coordinator = internal['coordinator'] as
    | { getSharedData: (key: string) => unknown }
    | undefined;
  if (!coordinator) return null;
  return (coordinator.getSharedData(`safety-report:${sessionId}`) as SafetyReport) ?? null;
}

/**
 * Retrieve session data from executor's internal sessions map.
 *
 * @param executor - Parallel executor instance / パラレルエクゼキューターインスタンス
 * @param sessionId - Session ID / セッションID
 * @returns Session data or null / セッションデータまたはnull
 */
function getSessionFromExecutor(
  executor: ReturnType<typeof createParallelExecutor>,
  sessionId: string,
): { taskBranches: Map<number, string>; workingDirectory: string } | null {
  // HACK(agent): Private field access needed until a public getSession() is added.
  const internal = executor as unknown as Record<string, unknown>;
  const sessions = internal['sessions'] as Map<string, ParallelExecutionSession> | undefined;
  if (!sessions) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  return { taskBranches: session.taskBranches, workingDirectory: session.workingDirectory };
}

type ParallelExecutionSession = {
  taskBranches: Map<number, string>;
  workingDirectory: string;
};
