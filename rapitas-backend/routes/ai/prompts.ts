/**
 * Prompts API Routes
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { generateOptimizedPrompt } from '../../services/claude-agent';
import { getDefaultProvider, getApiKeyForProvider } from '../../utils/ai-client';
import { getLabelsArray, toJsonString } from '../../utils/database/db-helpers';

export const promptsRoutes = new Elysia()
  .get('/tasks/:id/prompts', async ({ params }) => {
    const taskIdNum = parseInt(params.id);

    const task = await prisma.task.findUnique({
      where: { id: taskIdNum },
      include: {
        subtasks: {
          select: { id: true, title: true },
        },
      },
    });

    if (!task) {
      return { error: 'タスクが見つかりません' };
    }

    type SubtaskInfo = {
      id: number;
      title: string;
    };

    const taskIds = [taskIdNum, ...task.subtasks.map((st: SubtaskInfo) => st.id)];
    const prompts = await prisma.taskPrompt.findMany({
      where: { taskId: { in: taskIds } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        hasSubtasks: task.subtasks.length > 0,
      },
      subtasks: task.subtasks as SubtaskInfo[],
      prompts,
    };
  })

  .post('/tasks/:id/prompts', async (context) => {
    const { params, body, set } = context;
    const taskIdNum = parseInt(params.id);
    const { name, optimizedPrompt, structuredSections, qualityScore, originalDescription } =
      body as {
        name?: string;
        optimizedPrompt: string;
        structuredSections?: string;
        qualityScore?: number;
        originalDescription?: string;
      };

    if (!optimizedPrompt) {
      set.status = 400;
      return { error: 'optimizedPromptは必須です' };
    }

    const prompt = await prisma.taskPrompt.create({
      data: {
        taskId: taskIdNum,
        name,
        optimizedPrompt,
        structuredSections,
        qualityScore,
        originalDescription,
        isActive: true,
      },
    });

    return prompt;
  })

  .patch('/prompts/:id', async ({ params, body, set }) => {
    const promptId = parseInt(params.id);
    const { name, optimizedPrompt, isActive } = body as {
      name?: string;
      optimizedPrompt?: string;
      isActive?: boolean;
    };

    const existing = await prisma.taskPrompt.findUnique({
      where: { id: promptId },
    });

    if (!existing) {
      set.status = 404;
      return { error: 'プロンプトが見つかりません' };
    }

    const updated = await prisma.taskPrompt.update({
      where: { id: promptId },
      data: {
        ...(name !== undefined && { name }),
        ...(optimizedPrompt !== undefined && { optimizedPrompt }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return updated;
  })

  .delete('/prompts/:id', async (context) => {
    const { params, set } = context;
    const promptId = parseInt(params.id);

    const existing = await prisma.taskPrompt.findUnique({
      where: { id: promptId },
    });

    if (!existing) {
      set.status = 404;
      return { error: 'プロンプトが見つかりません' };
    }

    await prisma.taskPrompt.delete({
      where: { id: promptId },
    });

    return { success: true };
  })

  // Bulk prompt optimization for task and all subtasks
  .post('/tasks/:id/prompts/generate-all', async (context) => {
    const { params, set } = context;
    const taskIdNum = parseInt(params.id);

    const promptProvider = await getDefaultProvider();
    const promptApiKey = await getApiKeyForProvider(promptProvider);
    if (!promptApiKey) {
      set.status = 400;
      return {
        error: 'AIのAPIキーが設定されていません。設定ページでAPIキーを登録してください。',
      };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskIdNum },
      include: {
        subtasks: true,
      },
    });

    if (!task) {
      set.status = 404;
      return { error: 'タスクが見つかりません' };
    }

    const results: Array<{
      taskId: number;
      title: string;
      isSubtask: boolean;
      success: boolean;
      prompt?: unknown;
      error?: string;
    }> = [];

    // If no subtasks, optimize only the parent task
    if (task.subtasks.length === 0) {
      try {
        const { result } = await generateOptimizedPrompt(
          {
            title: task.title,
            description: task.description,
            priority: task.priority,
            labels: getLabelsArray(task.labels),
          },
          null,
          undefined,
          promptProvider,
        );

        // Save the prompt
        const savedPrompt = await prisma.taskPrompt.create({
          data: {
            taskId: task.id,
            name: `${task.title} - 最適化プロンプト`,
            originalDescription: task.description,
            optimizedPrompt: result.optimizedPrompt,
            structuredSections: toJsonString(result.structuredSections),
            qualityScore: result.promptQuality.score,
            isActive: true,
          },
        });

        results.push({
          taskId: task.id,
          title: task.title,
          isSubtask: false,
          success: true,
          prompt: savedPrompt,
        });
      } catch (error: unknown) {
        results.push({
          taskId: task.id,
          title: task.title,
          isSubtask: false,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } else {
      // Optimize each subtask individually
      for (const subtask of task.subtasks) {
        try {
          const { result } = await generateOptimizedPrompt(
            {
              title: subtask.title,
              description: subtask.description,
              priority: subtask.priority,
              labels: getLabelsArray(subtask.labels),
            },
            null,
            undefined,
            promptProvider,
          );

          // Save the prompt
          const savedPrompt = await prisma.taskPrompt.create({
            data: {
              taskId: subtask.id,
              name: `${subtask.title} - 最適化プロンプト`,
              originalDescription: subtask.description,
              optimizedPrompt: result.optimizedPrompt,
              structuredSections: toJsonString(result.structuredSections),
              qualityScore: result.promptQuality.score,
              isActive: true,
            },
          });

          results.push({
            taskId: subtask.id,
            title: subtask.title,
            isSubtask: true,
            success: true,
            prompt: savedPrompt,
          });
        } catch (error: unknown) {
          results.push({
            taskId: subtask.id,
            title: subtask.title,
            isSubtask: true,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    return {
      taskId: task.id,
      taskTitle: task.title,
      hasSubtasks: task.subtasks.length > 0,
      subtaskCount: task.subtasks.length,
      results,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
    };
  });
