/**
 * Developer Mode API Routes
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:developer-mode');
import {
  analyzeTask,
  generateOptimizedPrompt,
  formatPromptForAgent,
  generateBranchName,
  generateTaskTitle,
  type TaskAnalysisResult,
  type OptimizedPromptResult,
} from '../../services/claude-agent';
import { getDefaultProvider, getApiKeyForProvider } from '../../utils/ai-client';
import { getLabelsArray, toJsonString, fromJsonString } from '../../utils/db-helpers';

export const developerModeRoutes = new Elysia({ prefix: '/developer-mode' })

  .get('/config/:taskId', async (context) => {
    const { params } = context;
    const taskId = parseInt(params.taskId);
    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
      include: {
        agentSessions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        approvalRequests: {
          where: { status: 'pending' },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    return config;
  })

  .post('/enable/:taskId', async (context) => {
    const { params, body } = context;
    const taskId = parseInt(params.taskId);
    const { autoApprove, maxSubtasks, priority } = body as {
      autoApprove?: boolean;
      maxSubtasks?: number;
      priority?: string;
    };

    await prisma.task.update({
      where: { id: taskId },
      data: { isDeveloperMode: true },
    });

    let config;
    try {
      config = await prisma.developerModeConfig.upsert({
        where: { taskId },
        update: {
          isEnabled: true,
          ...(autoApprove !== undefined && { autoApprove }),
          ...(maxSubtasks !== undefined && { maxSubtasks }),
          ...(priority !== undefined && { priority }),
        },
        create: {
          taskId,
          isEnabled: true,
          autoApprove: autoApprove ?? false,
          maxSubtasks: maxSubtasks ?? 10,
          priority: priority ?? 'balanced',
        },
      });
<<<<<<< feature/fix-log-unique-output
    } catch (error: any) {
      if (error.code === 'P2002' && error.meta?.target?.includes('taskId')) {
        log.info(
          `Race condition detected on developerModeConfig.upsert for taskId ${taskId}, retrying with findUnique + update`,
        );
        config = await prisma.developerModeConfig.findUniqueOrThrow({
          where: { taskId },
        });
=======
    } catch (upsertError: unknown) {
      // NOTE: Prisma upsert can race under concurrent requests — both see no row, both try to create, one gets P2002.
      const isPrismaUniqueViolation =
        upsertError instanceof Error &&
        'code' in upsertError &&
        (upsertError as { code: string }).code === 'P2002';
      if (isPrismaUniqueViolation) {
        log.warn(`[API] Concurrent upsert race for taskId=${taskId}, updating existing record`);
>>>>>>> develop
        config = await prisma.developerModeConfig.update({
          where: { taskId },
          data: {
            isEnabled: true,
            ...(autoApprove !== undefined && { autoApprove }),
            ...(maxSubtasks !== undefined && { maxSubtasks }),
            ...(priority !== undefined && { priority }),
          },
        });
      } else {
<<<<<<< feature/fix-log-unique-output
        throw error;
=======
        throw upsertError;
>>>>>>> develop
      }
    }

    return config;
  })

  .delete('/disable/:taskId', async (context) => {
    const { params } = context;
    const taskId = parseInt(params.taskId);

    await prisma.task.update({
      where: { id: taskId },
      data: { isDeveloperMode: false },
    });

    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
    });

    if (config) {
      await prisma.developerModeConfig.update({
        where: { taskId },
        data: { isEnabled: false },
      });
    }

    return { success: true };
  })

  .patch('/config/:taskId', async (context) => {
    const { params, body } = context;
    const taskId = parseInt(params.taskId);
    const { autoApprove, notifyInApp, maxSubtasks, priority } = body as {
      autoApprove?: boolean;
      notifyInApp?: boolean;
      maxSubtasks?: number;
      priority?: string;
    };

    return await prisma.developerModeConfig.update({
      where: { taskId },
      data: {
        ...(autoApprove !== undefined && { autoApprove }),
        ...(notifyInApp !== undefined && { notifyInApp }),
        ...(maxSubtasks !== undefined && { maxSubtasks }),
        ...(priority !== undefined && { priority }),
      },
    });
  })

  // Task analysis and subtask suggestion
  .post('/analyze/:taskId', async (context) => {
    const { params, set } = context;
    const taskId = parseInt(params.taskId);

    const defaultProvider = await getDefaultProvider();
    const apiKey = await getApiKeyForProvider(defaultProvider);
    if (!apiKey) {
      set.status = 400;
      return {
        error: 'AIのAPIキーが設定されていません。設定ページでAPIキーを登録してください。',
      };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      set.status = 404;
      return { error: 'タスクが見つかりません' };
    }

    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
    });

    if (!config || !config.isEnabled) {
      set.status = 400;
      return {
        error:
          'このタスクでは開発者モードが有効になっていません。先に開発者モードを有効にしてください。',
      };
    }

    const session = await prisma.agentSession.create({
      data: {
        configId: config.id,
        status: 'running',
        startedAt: new Date(),
      },
    });

    try {
      const { result, tokensUsed } = await analyzeTask(
        {
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate: task.dueDate,
          estimatedHours: task.estimatedHours,
        },
        {
          maxSubtasks: config.maxSubtasks,
          priority: config.priority as 'aggressive' | 'balanced' | 'conservative',
          provider: defaultProvider,
        },
      );

      await prisma.agentAction.create({
        data: {
          sessionId: session.id,
          actionType: 'analysis',
          targetTaskId: taskId,
          input: toJsonString({ taskTitle: task.title }),
          output: toJsonString(result),
          tokensUsed,
          status: 'success',
        },
      });

      await prisma.agentSession.update({
        where: { id: session.id },
        data: {
          totalTokensUsed: tokensUsed,
          lastActivityAt: new Date(),
        },
      });

      // Auto-approve: create subtasks directly without approval request
      if (config.autoApprove) {
        // Atomic duplicate check and creation via transaction
        const createdSubtasks = await prisma.$transaction(
          async (tx) => {
            const existingSubtasks = await tx.task.findMany({
              where: { parentId: taskId },
              select: { title: true },
            });
            const existingTitles = new Set(
              existingSubtasks.map((st: { title: string }) => st.title.toLowerCase().trim()),
            );

            const created = [];
            for (const subtask of result.suggestedSubtasks) {
              const normalizedTitle = subtask.title.toLowerCase().trim();
              if (existingTitles.has(normalizedTitle)) {
                log.info(`[developer-mode] Skipping duplicate subtask: ${subtask.title}`);
                continue;
              }
              existingTitles.add(normalizedTitle);

              const newSubtask = await tx.task.create({
                data: {
                  title: subtask.title,
                  description: subtask.description,
                  priority: subtask.priority,
                  estimatedHours: subtask.estimatedHours,
                  parentId: taskId,
                  agentGenerated: true,
                },
              });
              created.push(newSubtask);
            }
            return created;
          },
          {
            isolationLevel: 'Serializable', // prevent race conditions
          },
        );

        await prisma.agentSession.update({
          where: { id: session.id },
          data: { status: 'completed', completedAt: new Date() },
        });

        return {
          sessionId: session.id,
          analysis: result,
          autoApproved: true,
          createdSubtasks,
        };
      }

      const approvalRequest = await prisma.approvalRequest.create({
        data: {
          configId: config.id,
          requestType: 'subtask_creation',
          title: `「${task.title}」のサブタスク提案`,
          description: result.summary,
          proposedChanges:
            toJsonString({
              subtasks: result.suggestedSubtasks,
              reasoning: result.reasoning,
              tips: result.tips,
              complexity: result.complexity,
              estimatedTotalHours: result.estimatedTotalHours,
            }) ?? '',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });

      if (config.notifyInApp) {
        await prisma.notification.create({
          data: {
            type: 'approval_request',
            title: 'サブタスク提案',
            message: `「${task.title}」に${result.suggestedSubtasks.length}個のサブタスクが提案されました`,
            link: `/tasks/${taskId}`,
            metadata: toJsonString({ approvalRequestId: approvalRequest.id }),
          },
        });
      }

      return {
        sessionId: session.id,
        analysis: result,
        approvalRequestId: approvalRequest.id,
        autoApproved: false,
      };
    } catch (error: unknown) {
      // Mark session as failed on error
      await prisma.agentSession.update({
        where: { id: session.id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date(),
        },
      });

      set.status = 500;
      return {
        error: 'Analysis failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  // Prompt optimization API
  .post('/optimize-prompt/:taskId', async (context) => {
    const { params, body, set } = context;
    const taskId = parseInt(params.taskId);
    const { clarificationAnswers, savePrompt } = (body || {}) as {
      clarificationAnswers?: Record<string, string>;
      savePrompt?: boolean;
    };

    const optimizeProvider = await getDefaultProvider();
    const optimizeApiKey = await getApiKeyForProvider(optimizeProvider);
    if (!optimizeApiKey) {
      set.status = 400;
      return {
        error: 'AIのAPIキーが設定されていません。設定ページでAPIキーを登録してください。',
      };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        subtasks: true,
      },
    });

    if (!task) {
      set.status = 404;
      return { error: 'タスクが見つかりません' };
    }

    // Get latest AI analysis result if available
    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
      include: {
        agentSessions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            agentActions: {
              where: { actionType: 'analysis', status: 'success' },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    let analysisResult = null;
    if (config?.agentSessions?.[0]?.agentActions?.[0]?.output) {
      analysisResult = fromJsonString(config.agentSessions[0].agentActions[0].output);
    }

    try {
      const { result, tokensUsed } = await generateOptimizedPrompt(
        {
          title: task.title,
          description: task.description,
          priority: task.priority,
          labels: getLabelsArray(task.labels),
        },
        analysisResult as TaskAnalysisResult | null,
        clarificationAnswers,
        optimizeProvider,
      );

      // Record token usage if session exists
      if (config?.agentSessions?.[0]) {
        await prisma.agentSession.update({
          where: { id: config.agentSessions[0].id },
          data: {
            totalTokensUsed: {
              increment: tokensUsed,
            },
            lastActivityAt: new Date(),
          },
        });
      }

      // Save prompt if no clarification questions and save option is enabled
      let savedPromptId = null;
      if (
        savePrompt &&
        (!result.clarificationQuestions || result.clarificationQuestions.length === 0)
      ) {
        const savedPrompt = await prisma.taskPrompt.create({
          data: {
            taskId,
            name: `${task.title} - 最適化プロンプト`,
            originalDescription: task.description,
            optimizedPrompt: result.optimizedPrompt,
            structuredSections: toJsonString(result.structuredSections),
            qualityScore: result.promptQuality.score,
            isActive: true,
          },
        });
        savedPromptId = savedPrompt.id;
      }

      const questionsCount = result.clarificationQuestions?.length || 0;
      const hasQuestions = questionsCount > 0;

      return {
        optimizedPrompt: result.optimizedPrompt,
        structuredSections: result.structuredSections,
        clarificationQuestions: result.clarificationQuestions || [],
        promptQuality: result.promptQuality,
        tokensUsed,
        hasQuestions,
        savedPromptId,
        taskInfo: {
          id: task.id,
          title: task.title,
          hasSubtasks: task.subtasks.length > 0,
          subtaskCount: task.subtasks.length,
        },
      };
    } catch (error: unknown) {
      log.error({ err: error }, 'Prompt optimization error');
      set.status = 500;
      return {
        error: 'プロンプト最適化に失敗しました',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  // Convert optimized prompt to agent execution format
  .post(
    '/format-prompt/:taskId',
    async (context) => {
      const { params, body, set } = context;
      const taskId = parseInt(params.taskId);
      const { optimizedResult } = body as { optimizedResult: OptimizedPromptResult };

      if (!optimizedResult) {
        set.status = 400;
        return { error: 'optimizedResult is required' };
      }

      const task = await prisma.task.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        set.status = 404;
        return { error: 'タスクが見つかりません' };
      }

      const formattedPrompt = formatPromptForAgent(optimizedResult, task.title);

      return {
        formattedPrompt,
      };
    },
    {
      body: t.Object({
        optimizedResult: t.Object({
          optimizedPrompt: t.String(),
          structuredSections: t.Object({
            objective: t.String(),
            context: t.String(),
            requirements: t.Array(t.String()),
            constraints: t.Array(t.String()),
            deliverables: t.Array(t.String()),
            technicalDetails: t.Optional(t.String()),
          }),
          promptQuality: t.Object({
            score: t.Number(),
            issues: t.Array(t.String()),
            suggestions: t.Array(t.String()),
          }),
        }),
      }),
    },
  )

  // Branch name generation API
  .post(
    '/generate-branch-name',
    async (context) => {
      const { body, set } = context;
      const { title, description } = (body || {}) as { title: string; description?: string };

      if (!title) {
        set.status = 400;
        return { error: 'タスクタイトルは必須です' };
      }

      const branchProvider = await getDefaultProvider();
      const branchApiKey = await getApiKeyForProvider(branchProvider);
      if (!branchApiKey) {
        set.status = 400;
        return {
          error: 'AIのAPIキーが設定されていません。設定ページでAPIキーを登録してください。',
        };
      }

      try {
        const result = await generateBranchName(title, description, branchProvider);
        return result;
      } catch (error: unknown) {
        log.error({ err: error }, 'Branch name generation error');
        set.status = 500;
        return {
          error: 'ブランチ名の生成に失敗しました',
          details: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    {
      body: t.Object({
        title: t.String(),
        description: t.Optional(t.String()),
      }),
    },
  )

  .get('/sessions/:taskId', async (context) => {
    const { params } = context;
    const taskId = parseInt(params.taskId);

    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
    });

    if (!config) {
      return [];
    }

    return await prisma.agentSession.findMany({
      where: { configId: config.id },
      include: {
        agentActions: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  })

  // Auto-generate title from task description
  .post(
    '/generate-title',
    async (context) => {
      const { body, set } = context;
      const { description } = body as { description: string };

      if (!description || !description.trim()) {
        set.status = 400;
        return { error: '説明文は必須です' };
      }

      try {
        const settings = await prisma.userSettings.findFirst();
        const titleProviderRaw = (settings as Record<string, unknown>)?.titleGenerationProvider as
          | string
          | undefined;
        // 'default' uses paid API; others fall back to ollama (local free AI)
        const titleProvider: import('../../utils/ai-client').AIProvider =
          titleProviderRaw === 'default' ? await getDefaultProvider() : 'ollama';

        // Paid APIs require an API key
        if (titleProvider !== 'ollama') {
          const titleApiKey = await getApiKeyForProvider(titleProvider);
          if (!titleApiKey) {
            set.status = 400;
            return {
              error: 'AIのAPIキーが設定されていません。設定ページでAPIキーを登録してください。',
            };
          }
        }

        const result = await generateTaskTitle(description, titleProvider);
        return result;
      } catch (error: unknown) {
        log.error({ err: error }, 'Title generation error');
        set.status = 500;
        return {
          error: 'タイトルの生成に失敗しました',
          details: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    {
      body: t.Object({
        description: t.String(),
      }),
    },
  );
