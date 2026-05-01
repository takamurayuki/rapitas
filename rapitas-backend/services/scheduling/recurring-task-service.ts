/**
 * Recurring Task Service
 *
 * Handles recurring task generation logic with workflow file inheritance.
 * Uses the existing recurrence-service.ts for RRULE parsing.
 */
import { PrismaClient, Task } from '@prisma/client';
import { createLogger } from '../../config/logger';
import { parseRRule, expandRecurrence, RECURRENCE_PRESETS } from './recurrence-service';
import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { getTaskWorkflowDir } from '../workflow/workflow-paths';

type PrismaInstance = InstanceType<typeof PrismaClient>;

const log = createLogger('recurring-task-service');

// Re-export presets for convenience
export { RECURRENCE_PRESETS };

/**
 * Input for setting recurrence on a task.
 */
export interface SetRecurrenceInput {
  recurrenceRule: string; // RRULE format: "FREQ=DAILY;INTERVAL=1"
  recurrenceEndAt?: Date | null; // Optional end date
  recurrenceTime?: string | null; // HH:MM format (e.g., "09:00", default: "00:00")
  inheritWorkflowFiles?: boolean; // Whether to inherit workflow files (default: true)
}

/**
 * Calculate the next occurrence date from today based on the recurrence rule.
 */
export function calculateNextOccurrence(
  recurrenceRule: string,
  fromDate: Date = new Date(),
  recurrenceEndAt?: Date | null,
): Date | null {
  const rule = parseRRule(recurrenceRule);

  // Start from tomorrow
  const tomorrow = new Date(fromDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  // Look ahead 1 year max
  const rangeEnd = new Date(fromDate);
  rangeEnd.setFullYear(rangeEnd.getFullYear() + 1);

  const dates = expandRecurrence(tomorrow, rule, tomorrow, rangeEnd, recurrenceEndAt, 1);

  return dates.length > 0 ? dates[0] : null;
}

/**
 * Set recurrence on an existing task (makes it a recurring master task).
 */
export async function setTaskRecurrence(
  prisma: PrismaInstance,
  taskId: number,
  input: SetRecurrenceInput,
): Promise<Task> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  // Validate RRULE format
  try {
    parseRRule(input.recurrenceRule);
  } catch (err) {
    throw new Error(`Invalid recurrence rule: ${input.recurrenceRule}`);
  }

  // Validate and normalize time format
  const recurrenceTime = input.recurrenceTime || '00:00';
  if (!/^\d{2}:\d{2}$/.test(recurrenceTime)) {
    throw new Error(`Invalid time format: ${recurrenceTime}. Expected HH:MM`);
  }

  // Calculate next occurrence
  const nextOccurrence = calculateNextOccurrence(
    input.recurrenceRule,
    new Date(),
    input.recurrenceEndAt,
  );

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      isRecurring: true,
      recurrenceRule: input.recurrenceRule,
      recurrenceEndAt: input.recurrenceEndAt ?? null,
      recurrenceTime,
      inheritWorkflowFiles: input.inheritWorkflowFiles ?? true,
      nextOccurrence,
    },
  });

  log.info(
    `[recurring-task] Set recurrence on task ${taskId}: ${input.recurrenceRule} at ${recurrenceTime}`,
  );

  return updated;
}

/**
 * Remove recurrence from a task.
 */
export async function removeTaskRecurrence(prisma: PrismaInstance, taskId: number): Promise<Task> {
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      isRecurring: false,
      recurrenceRule: null,
      recurrenceEndAt: null,
      nextOccurrence: null,
    },
  });

  log.info(`[recurring-task] Removed recurrence from task ${taskId}`);

  return updated;
}

/**
 * Resolve the workflow directory path from a task ID.
 */
async function resolveWorkflowDir(prisma: PrismaInstance, taskId: number): Promise<string | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { theme: { include: { category: true } } },
  });

  if (!task) return null;

  const categoryId = task.theme?.categoryId ?? null;
  const themeId = task.themeId ?? null;

  return getTaskWorkflowDir(categoryId, themeId, taskId);
}

/**
 * Read a workflow file if it exists.
 */
async function readWorkflowFile(
  dirPath: string,
  fileType: 'research' | 'plan' | 'verify',
): Promise<string | null> {
  const filePath = join(dirPath, `${fileType}.md`);
  try {
    await access(filePath);
    const content = await readFile(filePath, 'utf-8');
    return content;
  } catch {
    return null;
  }
}

/**
 * Inherit workflow context from the most recent completed task instance.
 * Returns a markdown summary to append to the new task's description.
 */
async function inheritWorkflowContext(
  prisma: PrismaInstance,
  masterTaskId: number,
): Promise<string | null> {
  // Find the most recently completed task generated from this master
  const lastCompletedTask = await prisma.task.findFirst({
    where: {
      sourceTaskId: masterTaskId,
      status: 'done',
    },
    orderBy: { completedAt: 'desc' },
  });

  if (!lastCompletedTask) {
    log.debug(`[recurring-task] No previous completed task found for master ${masterTaskId}`);
    return null;
  }

  const workflowDir = await resolveWorkflowDir(prisma, lastCompletedTask.id);
  if (!workflowDir) {
    log.warn(`[recurring-task] Could not resolve workflow dir for task ${lastCompletedTask.id}`);
    return null;
  }

  // Read workflow files
  const research = await readWorkflowFile(workflowDir, 'research');
  const plan = await readWorkflowFile(workflowDir, 'plan');
  const verify = await readWorkflowFile(workflowDir, 'verify');

  if (!research && !plan && !verify) {
    log.debug(`[recurring-task] No workflow files found for task ${lastCompletedTask.id}`);
    return null;
  }

  // Build context summary
  let summary = `\n\n---\n## 🔄 前回の実行履歴（自動継承）\n\n`;
  summary += `**前回実行日**: ${lastCompletedTask.completedAt ? new Date(lastCompletedTask.completedAt).toLocaleDateString('ja-JP') : '不明'}\n\n`;

  if (verify) {
    // Extract key insights from verify.md
    const verifyLines = verify.split('\n').filter((line) => line.trim());
    const concernsSection = verifyLines.find(
      (line) => line.includes('懸念事項') || line.includes('Unresolved'),
    );
    const metricsSection = verifyLines.filter(
      (line) => line.includes('テスト') || line.includes('変更') || line.includes('完了'),
    );

    summary += `### ✅ 前回の検証結果\n`;
    if (metricsSection.length > 0) {
      summary += metricsSection.slice(0, 3).join('\n') + '\n';
    }
    if (concernsSection) {
      summary += `\n⚠️ ${concernsSection}\n`;
    }
    summary += '\n';
  }

  if (plan) {
    // Extract improvement points from plan.md
    const planLines = plan.split('\n').filter((line) => line.trim());
    const riskSection = planLines.filter(
      (line) => line.includes('リスク') || line.includes('Risk'),
    );
    if (riskSection.length > 0) {
      summary += `### 📋 前回の計画からの学び\n`;
      summary += riskSection.slice(0, 3).join('\n') + '\n\n';
    }
  }

  summary += `💡 **提案**: 前回の実行結果を踏まえて、今回はより効率的に実施してください。\n`;
  summary += `詳細は前回のタスク [#${lastCompletedTask.id}](tasks/${lastCompletedTask.id}) を参照。\n`;

  log.info(`[recurring-task] Inherited workflow context from task ${lastCompletedTask.id}`);
  return summary;
}

/**
 * Generate a new task instance from a recurring master task with optional workflow inheritance.
 */
/**
 * Generate a new task instance from a recurring master task with optional workflow inheritance.
 */
export async function generateNextTaskInstance(
  prisma: PrismaInstance,
  masterTask: Task,
): Promise<Task | null> {
  if (!masterTask.isRecurring || !masterTask.recurrenceRule) {
    log.warn(`[recurring-task] Task ${masterTask.id} is not a recurring task`);
    return null;
  }

  const occurrenceDate = masterTask.nextOccurrence ?? new Date();

  // Inherit workflow context if enabled
  let inheritedContext: string | null = null;
  if (masterTask.inheritWorkflowFiles) {
    inheritedContext = await inheritWorkflowContext(prisma, masterTask.id);
  }

  // Build enhanced description
  const enhancedDescription = masterTask.description
    ? masterTask.description + (inheritedContext || '')
    : inheritedContext || '';

  const executionNumber = masterTask.recurrenceCount + 1;

  // Create the new task instance
  const newTask = await prisma.task.create({
    data: {
      title: `${masterTask.title} (#${executionNumber})`,
      description: enhancedDescription,
      status: 'todo',
      priority: masterTask.priority,
      labels: masterTask.labels,
      estimatedHours: masterTask.estimatedHours,
      dueDate: occurrenceDate,
      subject: masterTask.subject,
      themeId: masterTask.themeId,
      projectId: masterTask.projectId,
      milestoneId: masterTask.milestoneId,
      examGoalId: masterTask.examGoalId,
      isDeveloperMode: masterTask.isDeveloperMode,
      isAiTaskAnalysis: masterTask.isAiTaskAnalysis,
      workflowMode: masterTask.workflowMode,
      sourceTaskId: masterTask.id, // Link to master task
    },
  });

  // Copy task labels
  const taskLabels = await prisma.taskLabel.findMany({
    where: { taskId: masterTask.id },
  });

  if (taskLabels.length > 0) {
    await prisma.taskLabel.createMany({
      data: taskLabels.map((tl) => ({
        taskId: newTask.id,
        labelId: tl.labelId,
      })),
    });
  }

  // Calculate and update next occurrence on master task
  const nextOccurrence = calculateNextOccurrence(
    masterTask.recurrenceRule,
    occurrenceDate,
    masterTask.recurrenceEndAt,
  );

  await prisma.task.update({
    where: { id: masterTask.id },
    data: {
      nextOccurrence,
      recurrenceCount: executionNumber,
      lastGeneratedAt: new Date(),
    },
  });

  log.info(
    `[recurring-task] Generated task ${newTask.id} (execution #${executionNumber}) from master ${masterTask.id}, next: ${nextOccurrence?.toISOString() ?? 'none'}`,
  );

  return newTask;
}

/**
 * Process all pending recurring tasks and generate new instances.
 * Should be called by the scheduler (e.g., hourly).
 *
 * @param currentHour - Current hour (0-23) for time-based filtering. If not provided, all pending tasks are processed.
 */
export async function processAllPendingRecurrences(
  prisma: PrismaInstance,
  currentHour?: number,
): Promise<{ processed: number; generated: number; errors: number; skipped: number }> {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Find all recurring tasks where nextOccurrence <= now
  const pendingTasks = await prisma.task.findMany({
    where: {
      isRecurring: true,
      nextOccurrence: { lte: now },
      // Exclude completed or archived master tasks
      status: { notIn: ['done', 'archived'] },
    },
  });

  let generated = 0;
  let errors = 0;
  let skipped = 0;

  for (const task of pendingTasks) {
    try {
      // Check if it's time to execute (based on recurrenceTime)
      const targetTime = task.recurrenceTime || '00:00';
      const [targetHour, targetMinute] = targetTime.split(':').map(Number);

      // Only generate if current hour matches target hour (with minute tolerance of ±5 minutes)
      if (currentHour !== undefined) {
        if (now.getHours() !== targetHour) {
          skipped++;
          continue;
        }
        const minuteDiff = Math.abs(now.getMinutes() - targetMinute);
        if (minuteDiff > 5) {
          skipped++;
          continue;
        }
      }

      const newTask = await generateNextTaskInstance(prisma, task);
      if (newTask) {
        generated++;
      }
    } catch (err) {
      log.error({ err, taskId: task.id }, '[recurring-task] Error generating task instance');
      errors++;
    }
  }

  log.info(
    `[recurring-task] Processed ${pendingTasks.length} recurring tasks at ${currentTime}: ${generated} generated, ${skipped} skipped, ${errors} errors`,
  );

  return { processed: pendingTasks.length, generated, errors, skipped };
}

/**
 * Trigger next task generation when a recurring-generated task is completed.
 * This is called from the task completion handler.
 */
export async function onGeneratedTaskCompleted(
  prisma: PrismaInstance,
  completedTask: Task,
): Promise<Task | null> {
  if (!completedTask.sourceTaskId) {
    return null;
  }

  const masterTask = await prisma.task.findUnique({
    where: { id: completedTask.sourceTaskId },
  });

  if (!masterTask || !masterTask.isRecurring) {
    return null;
  }

  // Check if there's already a pending task for this master
  const existingPending = await prisma.task.findFirst({
    where: {
      sourceTaskId: masterTask.id,
      status: { notIn: ['done', 'archived'] },
    },
  });

  if (existingPending) {
    log.info(
      `[recurring-task] Task ${existingPending.id} already pending for master ${masterTask.id}`,
    );
    return null;
  }

  // Generate the next instance
  return generateNextTaskInstance(prisma, masterTask);
}

/**
 * Get the list of upcoming occurrences for preview.
 */
export function getUpcomingOccurrences(
  recurrenceRule: string,
  fromDate: Date = new Date(),
  recurrenceEndAt?: Date | null,
  maxCount: number = 10,
): Date[] {
  const rule = parseRRule(recurrenceRule);

  // Start from tomorrow
  const tomorrow = new Date(fromDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  // Look ahead 1 year max
  const rangeEnd = new Date(fromDate);
  rangeEnd.setFullYear(rangeEnd.getFullYear() + 1);

  return expandRecurrence(tomorrow, rule, tomorrow, rangeEnd, recurrenceEndAt, maxCount);
}

/**
 * Get all tasks generated from a master task.
 */
export async function getGeneratedTasks(
  prisma: PrismaInstance,
  masterTaskId: number,
  options: { limit?: number; includeCompleted?: boolean } = {},
): Promise<Task[]> {
  const { limit = 50, includeCompleted = true } = options;

  return prisma.task.findMany({
    where: {
      sourceTaskId: masterTaskId,
      ...(includeCompleted ? {} : { status: { notIn: ['done', 'archived'] } }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
