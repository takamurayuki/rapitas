/**
 * DeveloperMode Prompt Routes
 *
 * Endpoints for prompt optimization, prompt formatting for agent execution,
 * branch name generation, and task title generation.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import {
  generateOptimizedPrompt,
  formatPromptForAgent,
  generateBranchName,
  generateTaskTitle,
  type TaskAnalysisResult,
  type OptimizedPromptResult,
} from '../../../services/claude-agent';
import { getDefaultProvider, getApiKeyForProvider } from '../../../utils/ai-client';
import { getLabelsArray, toJsonString, fromJsonString } from '../../../utils/db-helpers';

const log = createLogger('routes:developer-mode:prompt');

/**
 * Route group for prompt-related AI endpoints.
 */
export const developerModePromptRoutes = new Elysia({ prefix: '/developer-mode' })

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
      include: { subtasks: true },
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
          data: { totalTokensUsed: { increment: tokensUsed }, lastActivityAt: new Date() },
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

      const hasQuestions = (result.clarificationQuestions?.length || 0) > 0;

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

      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        set.status = 404;
        return { error: 'タスクが見つかりません' };
      }

      const formattedPrompt = formatPromptForAgent(optimizedResult, task.title);
      return { formattedPrompt };
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
        const titleProvider: import('../../../utils/ai-client').AIProvider =
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
