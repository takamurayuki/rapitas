/**
 * DeveloperMode Analyze Route
 *
 * POST /developer-mode/analyze/:taskId — runs AI task analysis and either
 * creates subtasks automatically (autoApprove) or creates an approval request.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { analyzeTask } from '../../../services/claude-agent';
import { getDefaultProvider, getApiKeyForProvider } from '../../../utils/ai-client';
import { toJsonString } from '../../../utils/database/db-helpers';

const log = createLogger('routes:developer-mode:analyze');

/**
 * Route handler for AI-driven task analysis and subtask suggestion.
 */
export const developerModeAnalyzeRoute = new Elysia({ prefix: '/developer-mode' })

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

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      set.status = 404;
      return { error: 'タスクが見つかりません' };
    }

    const config = await prisma.developerModeConfig.findUnique({ where: { taskId } });
    if (!config || !config.isEnabled) {
      set.status = 400;
      return {
        error:
          'このタスクでは開発者モードが有効になっていません。先に開発者モードを有効にしてください。',
      };
    }

    const session = await prisma.agentSession.create({
      data: { configId: config.id, status: 'running', startedAt: new Date() },
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
        data: { totalTokensUsed: tokensUsed, lastActivityAt: new Date() },
      });

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
          { isolationLevel: 'Serializable' }, // prevent race conditions
        );

        await prisma.agentSession.update({
          where: { id: session.id },
          data: { status: 'completed', completedAt: new Date() },
        });

        return { sessionId: session.id, analysis: result, autoApproved: true, createdSubtasks };
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
  });
