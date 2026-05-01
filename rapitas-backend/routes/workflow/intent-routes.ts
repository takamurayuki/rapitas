/**
 * IntentRoutes
 *
 * API endpoints for intent-driven development.
 * Parse .intent files, compile to tasks, and export tasks as intents.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { parseIntentFile, exportToIntentFormat } from '../../services/intent/intent-parser';
import { compileIntent } from '../../services/intent/intent-compiler';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getTaskWorkflowDir } from '../../services/workflow/workflow-paths';

const log = createLogger('routes:intent');

export const intentRoutes = new Elysia({ prefix: '/intent' })
  /**
   * Parse an intent file and preview the result without creating a task.
   */
  .post(
    '/parse',
    async (context) => {
      const { body } = context;
      const content = (body as { content: string }).content;

      const result = parseIntentFile(content);
      if (!result.success) {
        return { success: false, errors: result.errors, warnings: result.warnings };
      }

      const compiled = compileIntent(result.intent!);

      return {
        success: true,
        data: {
          intent: result.intent,
          compiled: {
            taskData: compiled.taskData,
            planPreview: compiled.planContent.slice(0, 500),
            promptPreview: compiled.compiledPrompt.slice(0, 500),
          },
          warnings: result.warnings,
        },
      };
    },
    {
      body: t.Object({ content: t.String() }),
    },
  )

  /**
   * Create a task from an intent file. Compiles intent → task + workflow files.
   */
  .post(
    '/create',
    async (context) => {
      const { body } = context;
      const { content, themeId } = body as { content: string; themeId?: number };

      const parseResult = parseIntentFile(content);
      if (!parseResult.success || !parseResult.intent) {
        return { success: false, errors: parseResult.errors };
      }

      const compiled = compileIntent(parseResult.intent);

      try {
        // Create the task
        const task = await prisma.task.create({
          data: {
            title: compiled.taskData.title,
            description: compiled.taskData.description,
            priority: compiled.taskData.priority,
            estimatedHours: compiled.taskData.estimatedHours,
            workflowMode: compiled.taskData.workflowMode,
            autoApprovePlan: compiled.taskData.autoApprovePlan,
            themeId: themeId || null,
            status: 'todo',
            isDeveloperMode: true,
          },
        });

        // Save workflow files to the canonical workflow base dir
        // (`${RAPITAS_DATA_DIR || ~/.rapitas}/workflows/<cat>/<theme>/<task>/`).
        // Using process.cwd()/tasks here was the legacy in-repo location and
        // is no longer read by the workflow API.
        const categoryId = themeId
          ? ((
              await prisma.theme
                .findUnique({ where: { id: themeId }, select: { categoryId: true } })
                .catch(() => null)
            )?.categoryId ?? null)
          : null;
        const taskDir = getTaskWorkflowDir(categoryId, themeId ?? null, task.id);

        const { mkdir, writeFile } = await import('fs/promises');
        await mkdir(taskDir, { recursive: true });

        // Save pre-filled workflow files
        await writeFile(join(taskDir, 'research.md'), compiled.researchContent, 'utf-8');
        await writeFile(join(taskDir, 'plan.md'), compiled.planContent, 'utf-8');

        // Save the original intent file for reference
        await writeFile(join(taskDir, 'intent.md'), content, 'utf-8');

        // Update workflow status (research + plan already saved)
        await prisma.task.update({
          where: { id: task.id },
          data: {
            workflowStatus: compiled.taskData.autoApprovePlan ? 'plan_approved' : 'plan_created',
          },
        });

        // Store the compiled prompt for execution
        try {
          await prisma.taskPrompt.create({
            data: {
              taskId: task.id,
              originalDescription: content,
              optimizedPrompt: compiled.compiledPrompt,
            },
          });
        } catch {
          // NOTE: TaskPrompt creation may fail if model doesn't exist — non-fatal
          log.debug(`[Intent] TaskPrompt creation skipped for task ${task.id}`);
        }

        log.info(
          `[Intent] Created task #${task.id} from intent: "${task.title}" (mode: ${compiled.taskData.workflowMode}, autoApprove: ${compiled.taskData.autoApprovePlan})`,
        );

        return {
          success: true,
          data: {
            taskId: task.id,
            title: task.title,
            workflowMode: compiled.taskData.workflowMode,
            autoApprove: compiled.taskData.autoApprovePlan,
            filesCreated: ['research.md', 'plan.md', 'intent.md'],
            warnings: parseResult.warnings,
          },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error({ err: error }, '[Intent] Task creation failed');
        return { success: false, error: msg };
      }
    },
    {
      body: t.Object({
        content: t.String(),
        themeId: t.Optional(t.Number()),
      }),
    },
  )

  /**
   * Export a task as an intent file (reverse compilation).
   */
  .get(
    '/export/:taskId',
    async (context) => {
      const { params } = context;
      const taskId = parseInt(params.taskId);

      try {
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: { theme: { include: { category: true } } },
        });

        if (!task) return { success: false, error: 'Task not found' };

        // Load workflow files from the canonical workflow base dir
        // (`${RAPITAS_DATA_DIR || ~/.rapitas}/workflows/<cat>/<theme>/<task>/`).
        const taskDir = getTaskWorkflowDir(
          task.theme?.categoryId ?? null,
          task.themeId ?? null,
          taskId,
        );

        let planContent: string | null = null;
        let verifyContent: string | null = null;
        try {
          planContent = await readFile(join(taskDir, 'plan.md'), 'utf-8');
        } catch {
          /* no plan */
        }
        try {
          verifyContent = await readFile(join(taskDir, 'verify.md'), 'utf-8');
        } catch {
          /* no verify */
        }

        const intentContent = exportToIntentFormat(task, {
          plan: planContent,
          verify: verifyContent,
        });

        return {
          success: true,
          data: {
            taskId,
            content: intentContent,
          },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: msg };
      }
    },
    {
      params: t.Object({ taskId: t.String() }),
    },
  );
