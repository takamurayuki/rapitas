/**
 * Recurring Task Service
 *
 * Handles recurring task generation and management.
 * Uses the existing recurrence-service.ts for RRULE parsing.
 */
import { PrismaClient, Task } from '@prisma/client';
import { createLogger } from '../config/logger';
import { parseRRule, expandRecurrence, RECURRENCE_PRESETS } from './recurrence-service';

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
      nextOccurrence,
    },
  });

  log.info(`[recurring-task] Set recurrence on task ${taskId}: ${input.recurrenceRule}`);

  return updated;
}

/**
 * Remove recurrence from a task.
 */
export async function removeTaskRecurrence(
  prisma: PrismaInstance,
  taskId: number,
): Promise<Task> {
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
 * Generate a new task instance from a recurring master task.
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

  // Create the new task instance
  const newTask = await prisma.task.create({
    data: {
      title: masterTask.title,
      description: masterTask.description,
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
    data: { nextOccurrence },
  });

  log.info(
    `[recurring-task] Generated task ${newTask.id} from master ${masterTask.id}, next: ${nextOccurrence?.toISOString() ?? 'none'}`,
  );

  return newTask;
}

/**
 * Process all pending recurring tasks and generate new instances.
 * Should be called by the scheduler (e.g., daily at midnight).
 */
export async function processAllPendingRecurrences(
  prisma: PrismaInstance,
): Promise<{ processed: number; generated: number; errors: number }> {
  const now = new Date();

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

  for (const task of pendingTasks) {
    try {
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
    `[recurring-task] Processed ${pendingTasks.length} recurring tasks: ${generated} generated, ${errors} errors`,
  );

  return { processed: pendingTasks.length, generated, errors };
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
