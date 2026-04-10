/**
 * Task Quick-Create Pipeline Route
 *
 * NL parse -> AI title -> task creation -> complexity analysis ->
 * subtask generation -> execution instructions. NDJSON streaming.
 * Extracted from tasks.ts to stay under the 500-line per-file limit.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error-handler';
import { createLogger } from '../../config/logger';
import { createTask } from '../../services/task/task-service';
import { parseNaturalLanguageTask } from '../../services/ai/natural-language-parser';
import {
  analyzeTask,
  generateExecutionInstructions,
} from '../../services/claude-agent/task-analyzer';
import { analyzeTaskComplexity } from '../../services/workflow/complexity-analyzer';
import { getDefaultProvider } from '../../utils/ai-client';
import { generateTaskTitle } from '../../services/claude-agent/naming-service';

const logger = createLogger('task-quick-create');

export const taskQuickCreateRoutes = new Elysia({ prefix: '/tasks' })
  // Quick create: NL parse → AI title → task → complexity → subtasks → instructions pipeline (NDJSON streaming)
  .post(
    '/quick-create',
    async ({ body }) => {
      const { text, themeId } = body;

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (data: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
          };

          try {
            // Step 1: Parse natural language
            send({ step: 'parsing', status: 'in_progress' });
            const parsed = parseNaturalLanguageTask(text);
            send({ step: 'parsing', status: 'done', data: parsed });

            // Step 2: AI title summarization
            send({ step: 'summarizing', status: 'in_progress' });
            let title = parsed.title;
            try {
              const provider = await getDefaultProvider();
              const result = await generateTaskTitle(text, provider);
              if (result.title) {
                title = result.title;
              }
            } catch (e) {
              logger.warn(
                { err: e },
                '[quick-create] AI title summarization failed, using parsed title',
              );
            }
            send({ step: 'summarizing', status: 'done', data: { title } });

            // Step 3: Create task
            send({ step: 'creating', status: 'in_progress' });
            const taskData: Parameters<typeof createTask>[1] = {
              title,
              ...(parsed.priority && { priority: parsed.priority }),
              ...(parsed.estimatedHours && { estimatedHours: parsed.estimatedHours }),
              ...(parsed.dueDate && { dueDate: parsed.dueDate }),
              ...(themeId && { themeId }),
              status: 'todo',
            };

            const task = await createTask(prisma, taskData);
            if (!task) {
              throw new AppError(500, 'Failed to create task');
            }
            send({ step: 'creating', status: 'done', data: { id: task.id, title: task.title } });

            // Step 4: Analyze complexity
            send({ step: 'analyzing', status: 'in_progress' });
            const complexity = analyzeTaskComplexity({
              title: task.title,
              description: task.description || undefined,
              estimatedHours: task.estimatedHours || undefined,
              priority: task.priority,
              labels: [],
            });

            const provider = await getDefaultProvider();
            const analysisConfig = {
              priority: 'balanced' as const,
              maxSubtasks: 10,
              provider,
            };

            const analysis = await analyzeTask(
              {
                id: task.id,
                title: task.title,
                description: task.description,
                priority: task.priority,
                dueDate: task.dueDate,
                estimatedHours: task.estimatedHours,
              },
              analysisConfig,
            );
            send({
              step: 'analyzing',
              status: 'done',
              data: {
                score: complexity.complexityScore,
                subtaskCount: analysis.result.suggestedSubtasks.length,
              },
            });

            // Step 5: Create subtasks
            send({ step: 'generating_subtasks', status: 'in_progress' });
            const createdSubtasks = [];
            for (const subtask of analysis.result.suggestedSubtasks) {
              const sub = await createTask(prisma, {
                title: subtask.title,
                description: subtask.description,
                priority: subtask.priority || task.priority,
                estimatedHours: subtask.estimatedHours,
                parentId: task.id,
                ...(themeId && { themeId }),
              });
              createdSubtasks.push(sub);
            }
            send({
              step: 'generating_subtasks',
              status: 'done',
              data: { count: createdSubtasks.length },
            });

            // Step 6: Generate execution instructions
            send({ step: 'generating_instructions', status: 'in_progress' });
            const instructions = await generateExecutionInstructions(
              { title: task.title, description: task.description },
              analysis.result.suggestedSubtasks,
              provider,
            );

            await prisma.task.update({
              where: { id: task.id },
              data: {
                description: `${task.description || ''}\n\n---\n## 実行手順\n${instructions.instructions}`,
              },
            });
            send({ step: 'generating_instructions', status: 'done' });

            // Complete
            send({ step: 'complete', status: 'done', taskId: task.id });
          } catch (error) {
            logger.error({ err: error }, '[tasks/quick-create] Pipeline failed');
            send({
              step: 'error',
              status: 'error',
              message: error instanceof Error ? error.message : 'Quick create pipeline failed',
            });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Transfer-Encoding': 'chunked',
          'Cache-Control': 'no-cache',
        },
      });
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1 }),
        themeId: t.Optional(t.Number()),
        autoExecute: t.Optional(t.Boolean()),
        agentConfigId: t.Optional(t.Number()),
      }),
    },
  );
