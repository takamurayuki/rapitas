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

        const executor = getParallelExecutor();
        const session = await executor.startSession(
          taskId,
          analysisResult.plan,
          analysisResult.treeMap.nodes,
          task.theme?.workingDirectory || getProjectRoot(),
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

        const taskBranches = Array.from(sessionData.taskBranches.entries())
          .map(([taskId, branchName]) => ({ taskId, branchName }));

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
   * Create a PR for a completed task branch with implementation summary.
   */
  .post(
    '/tasks/:taskId/create-pr',
    async (context) => {
      const { params, body } = context;
      try {
        const taskId = parseInt(params.taskId);
        const baseBranch = (body as Record<string, unknown>).baseBranch as string | undefined;

        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: {
            theme: true,
            parent: true,
            developerModeConfig: {
              include: {
                agentSessions: {
                  orderBy: { lastActivityAt: 'desc' },
                  take: 1,
                },
              },
            },
          },
        });

        if (!task) {
          return { success: false, error: 'タスクが見つかりません' };
        }

        const latestSession = task.developerModeConfig?.agentSessions?.[0];
        const branchName = latestSession?.branchName;
        const workingDirectory = task.theme?.workingDirectory || getProjectRoot();

        if (!branchName) {
          return { success: false, error: 'ブランチが見つかりません' };
        }

        const prBody = await buildPRBody(taskId, task, workingDirectory);

        const gitOps = new GitOperations();

        // NOTE: Push from worktree if available, otherwise from main repo
        const pushDir = latestSession?.worktreePath || workingDirectory;

        try {
          const { execSync } = await import('child_process');
          execSync(`git push -u origin ${branchName}`, {
            cwd: pushDir,
            encoding: 'utf8',
            timeout: 30000,
          });
        } catch (pushErr) {
          log.warn({ err: pushErr }, `[PR] Push attempt from ${pushDir}, trying main repo`);
          const { execSync } = await import('child_process');
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

        if (!prResult.success) {
          return { success: false, error: prResult.error };
        }

        // Record PR info in DB
        await prisma.task.update({
          where: { id: taskId },
          data: {
            githubPrId: prResult.prNumber,
          },
        });

        await prisma.activityLog.create({
          data: {
            taskId,
            action: 'parallel_pr_created',
            metadata: JSON.stringify({
              prUrl: prResult.prUrl,
              prNumber: prResult.prNumber,
              branchName,
            }),
            createdAt: new Date(),
          },
        });

        log.info(
          `[PR] Created PR #${prResult.prNumber} for task ${taskId}: ${prResult.prUrl}`,
        );

        return {
          success: true,
          data: {
            prUrl: prResult.prUrl,
            prNumber: prResult.prNumber,
            branchName,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ errorMessage }, '[PR] Failed to create PR');
        return { success: false, error: errorMessage };
      }
    },
    {
      params: t.Object({
        taskId: t.String(),
      }),
      body: t.Object({
        baseBranch: t.Optional(t.String()),
      }),
    },
  )

  /**
   * Approve and merge a task's PR, then update local develop.
   */
  .post(
    '/tasks/:taskId/approve-merge',
    async (context) => {
      const { params } = context;
      try {
        const taskId = parseInt(params.taskId);

        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: {
            theme: true,
            developerModeConfig: {
              include: {
                agentSessions: {
                  orderBy: { lastActivityAt: 'desc' },
                  take: 1,
                },
              },
            },
          },
        });

        if (!task) {
          return { success: false, error: 'タスクが見つかりません' };
        }

        if (!task.githubPrId) {
          return { success: false, error: 'PRが見つかりません。先にPRを作成してください。' };
        }

        const workingDirectory = task.theme?.workingDirectory || getProjectRoot();
        const gitOps = new GitOperations();

        // Merge PR (squash for parallel tasks)
        const mergeResult = await gitOps.mergePullRequest(
          workingDirectory,
          task.githubPrId,
          1, // NOTE: Always squash for parallel task branches (single logical unit)
          'develop',
        );

        if (!mergeResult.success) {
          return { success: false, error: mergeResult.error };
        }

        // Update task status
        await prisma.task.update({
          where: { id: taskId },
          data: { status: 'done' },
        });

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

        await prisma.activityLog.create({
          data: {
            taskId,
            action: 'parallel_pr_merged',
            metadata: JSON.stringify({
              prNumber: task.githubPrId,
              mergeStrategy: mergeResult.mergeStrategy,
            }),
            createdAt: new Date(),
          },
        });

        log.info(
          `[Merge] Merged PR #${task.githubPrId} for task ${taskId} (${mergeResult.mergeStrategy})`,
        );

        return {
          success: true,
          data: {
            prNumber: task.githubPrId,
            mergeStrategy: mergeResult.mergeStrategy,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ errorMessage }, '[Merge] Failed to merge PR');
        return { success: false, error: errorMessage };
      }
    },
    {
      params: t.Object({
        taskId: t.String(),
      }),
    },
  )

  /**
   * Get PR status for a task.
   */
  .get(
    '/tasks/:taskId/pr-status',
    async (context) => {
      const { params } = context;
      try {
        const taskId = parseInt(params.taskId);

        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: {
            id: true,
            title: true,
            status: true,
            githubPrId: true,
          },
        });

        if (!task) {
          return { success: false, error: 'タスクが見つかりません' };
        }

        let prInfo: { url?: string; state?: string; mergeable?: boolean } | null = null;

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
            // NOTE: gh command may fail if PR was already merged/closed
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
      params: t.Object({
        taskId: t.String(),
      }),
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

  // Header
  sections.push(`## Summary\n\nTask #${taskId}: ${task.title}`);
  if (task.description) {
    sections.push(`### Description\n\n${task.description.slice(0, 500)}`);
  }

  // Plan comparison
  const planContent = await readWorkflowFile(taskId, 'plan');
  const verifyContent = await readWorkflowFile(taskId, 'verify');

  if (planContent) {
    sections.push(`### Implementation Plan\n\n<details>\n<summary>Original Plan</summary>\n\n${planContent}\n\n</details>`);
  }

  if (verifyContent) {
    sections.push(`### Verification Report\n\n${verifyContent}`);
  }

  // Diff stats
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
    // NOTE: diff stat may fail if develop doesn't exist or branch diverged — non-fatal
  }

  // Plan deviation analysis
  if (planContent && verifyContent) {
    const deviation = analyzePlanDeviation(planContent, verifyContent);
    if (deviation) {
      sections.push(`### Plan Deviation\n\n${deviation}`);
    }
  }

  sections.push(
    `---\n🤖 Generated automatically by Rapitas AI Agent`,
  );

  return sections.join('\n\n');
}

/**
 * Read a workflow file for a task.
 *
 * @param taskId - Task ID / タスクID
 * @param fileType - Workflow file type / ワークフローファイルタイプ
 * @returns File content or null / ファイル内容またはnull
 */
async function readWorkflowFile(
  taskId: number,
  fileType: string,
): Promise<string | null> {
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
 *
 * @param planContent - Plan file content / プランファイルの内容
 * @param verifyContent - Verify file content / 検証ファイルの内容
 * @returns Deviation analysis or null if no significant deviation / 差異分析またはnull
 */
function analyzePlanDeviation(planContent: string, verifyContent: string): string | null {
  const planChecklist = extractChecklistItems(planContent);
  const verifyChecklist = extractChecklistItems(verifyContent);

  if (planChecklist.length === 0) return null;

  const planFiles = extractMentionedFiles(planContent);
  const verifyFiles = extractMentionedFiles(verifyContent);

  const addedFiles = verifyFiles.filter((f) => !planFiles.includes(f));
  const removedFiles = planFiles.filter((f) => !verifyFiles.includes(f));

  const lines: string[] = [];

  if (addedFiles.length > 0) {
    lines.push(
      `**Plan外の変更ファイル**: ${addedFiles.join(', ')}`,
    );
  }

  if (removedFiles.length > 0) {
    lines.push(
      `**Planにあるが未変更のファイル**: ${removedFiles.join(', ')}`,
    );
  }

  const completedCount = verifyChecklist.filter((item) => item.startsWith('[x]') || item.startsWith('[X]')).length;
  const totalPlanned = planChecklist.length;

  if (totalPlanned > 0) {
    const completionRate = Math.round((completedCount / totalPlanned) * 100);
    lines.push(`**Plan達成率**: ${completedCount}/${totalPlanned} (${completionRate}%)`);
  }

  if (addedFiles.length === 0 && removedFiles.length === 0 && lines.length <= 1) {
    lines.unshift('Planからの大きな逸脱はありません。');
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Extract checklist items from markdown.
 *
 * @param content - Markdown content / Markdownコンテンツ
 * @returns Checklist items / チェックリスト項目
 */
function extractChecklistItems(content: string): string[] {
  const matches = content.match(/- \[[ xX]\].+/g);
  return matches || [];
}

/**
 * Extract file paths mentioned in markdown.
 *
 * @param content - Markdown content / Markdownコンテンツ
 * @returns Unique file paths / ユニークなファイルパス
 */
function extractMentionedFiles(content: string): string[] {
  const pattern = /[\w\-./]+\.[a-zA-Z]{1,10}/g;
  const matches = content.match(pattern) || [];
  // NOTE: Filter out common non-file patterns like version numbers (e.g., "v1.0")
  return [...new Set(matches.filter((m) => !m.match(/^v?\d+\.\d+/) && m.includes('/')))];
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
