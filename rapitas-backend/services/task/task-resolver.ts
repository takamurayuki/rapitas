/**
 * Task Resolver
 *
 * Single source of truth for resolving a Task ID to a validated Task row with
 * its commonly-needed relations. Not responsible for HTTP handling, business
 * logic, or task mutations.
 */
import type { Prisma } from '../../generated/prisma-postgres';
import { prisma } from '../../config/database';

/** Task with its Theme (workingDirectory / name / defaultBranch etc.) */
export type TaskWithTheme = Prisma.TaskGetPayload<{
  select: {
    id: true;
    themeId: true;
    workflowStatus: true;
    theme: { select: { workingDirectory: true; name: true } };
  };
}>;

/** Task with Theme + Category — needed for workflow directory resolution. */
export type TaskWithThemeAndCategory = Prisma.TaskGetPayload<{
  include: { theme: { include: { category: true } } };
}>;

/** Task with DeveloperModeConfig + Theme — needed for agent execution launch. */
export type TaskForExecution = Prisma.TaskGetPayload<{
  include: { developerModeConfig: true; theme: true };
}>;

/** Minimal shape for resolving a task's effective working directory. */
export type TaskWorkingDirectory = Prisma.TaskGetPayload<{
  select: {
    themeId: true;
    workingDirectory: true;
    theme: { select: { workingDirectory: true } };
  };
}>;

/**
 * Workflow state scalars for a task — used by workflow advancement, role resolution,
 * scheduler, and queue checks. parentId is included because runner completion
 * propagation needs it to detect subtask relationships.
 */
export type TaskWorkflowState = Prisma.TaskGetPayload<{
  select: {
    id: true;
    status: true;
    workflowStatus: true;
    workflowMode: true;
    parentId: true;
  };
}>;

/** Minimal shape for branch-name generation: task title and description. */
export type TaskTitle = Prisma.TaskGetPayload<{
  select: { id: true; title: true; description: true };
}>;

/** Minimal shape for resolving a task's theme association. */
export type TaskThemeId = Prisma.TaskGetPayload<{
  select: { id: true; themeId: true };
}>;

/** Full shape required for complexity analysis — needs labels + theme join. */
export type TaskForComplexityAnalysis = Prisma.TaskGetPayload<{
  include: { theme: true; taskLabels: { include: { label: true } } };
}>;

/**
 * Resolve a Task ID to its Theme-joined row (select-based, lightweight).
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Task with theme select, or null. / テーマ付きタスク、なければnull
 */
export async function resolveTaskWithTheme(taskId: number): Promise<TaskWithTheme | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      select: {
        id: true,
        themeId: true,
        workflowStatus: true,
        theme: { select: { workingDirectory: true, name: true } },
      },
    })
    .catch(() => null);
}

/**
 * Resolve a Task ID to its full Theme + Category join.
 * Used for workflow directory resolution (category/theme IDs required).
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Task with theme and category, or null. / テーマ・カテゴリ付きタスク、なければnull
 */
export async function resolveTaskWithThemeAndCategory(
  taskId: number,
): Promise<TaskWithThemeAndCategory | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      include: { theme: { include: { category: true } } },
    })
    .catch(() => null);
}

/**
 * Resolve a Task ID to the shape required for agent execution launch.
 * Includes DeveloperModeConfig and Theme relations.
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Task with developerModeConfig and theme, or null. / 開発者モード設定・テーマ付きタスク、なければnull
 */
export async function resolveTaskForExecution(taskId: number): Promise<TaskForExecution | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      include: { developerModeConfig: true, theme: true },
    })
    .catch(() => null);
}

/**
 * Resolve a Task ID to the minimal shape needed for working-directory lookup.
 * Uses select (not include) to keep the query lightweight.
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Minimal task with workingDirectory fields, or null. / 作業ディレクトリフィールドのみのタスク、なければnull
 */
export async function resolveTaskWorkingDirectory(
  taskId: number,
): Promise<TaskWorkingDirectory | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      select: {
        themeId: true,
        workingDirectory: true,
        theme: { select: { workingDirectory: true } },
      },
    })
    .catch(() => null);
}

/**
 * Resolve a Task ID to its workflow state scalars.
 * Used across workflow advancement, queue checks, role resolution, and scheduler.
 * parentId is included for subtask completion propagation.
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Workflow state scalars, or null. / ワークフロー状態スカラー、なければnull
 */
export async function resolveTaskWorkflowState(taskId: number): Promise<TaskWorkflowState | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        workflowStatus: true,
        workflowMode: true,
        parentId: true,
      },
    })
    .catch(() => null);
}

/**
 * Resolve a Task ID to its title and description — used for branch-name
 * generation (description feeds the AI prompt for better English slugs).
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Task title/description row, or null. / タイトル・説明行、なければnull
 */
export async function resolveTaskTitle(taskId: number): Promise<TaskTitle | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      select: { id: true, title: true, description: true },
    })
    .catch(() => null);
}

/**
 * Resolve a Task ID to its themeId — used for scheduler theme lookup.
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Task themeId row, or null. / themeId行、なければnull
 */
export async function resolveTaskThemeId(taskId: number): Promise<TaskThemeId | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      select: { id: true, themeId: true },
    })
    .catch(() => null);
}

/**
 * Resolve a Task ID to the shape required for complexity analysis.
 * Includes theme and task labels with label details (join required).
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Task with theme and labels, or null. / テーマ・ラベル付きタスク、なければnull
 */
export async function resolveTaskForComplexityAnalysis(
  taskId: number,
): Promise<TaskForComplexityAnalysis | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      include: { theme: true, taskLabels: { include: { label: true } } },
    })
    .catch(() => null);
}

/** Minimal subtask info needed for subtask completion propagation. */
export type TaskSubtaskInfo = Prisma.TaskGetPayload<{
  select: { id: true; parentId: true; title: true };
}>;

/** Shape required for plan auto-approve decision in the workflow runner. */
export type TaskForPlanApproval = Prisma.TaskGetPayload<{
  select: { id: true; autoApprovePlan: true; parentId: true };
}>;

/** Shape required for auto-merge candidate resolution. */
export type TaskForAutoMerge = Prisma.TaskGetPayload<{
  select: {
    id: true;
    title: true;
    status: true;
    workflowStatus: true;
    completedAt: true;
    workingDirectory: true;
    theme: { select: { workingDirectory: true; defaultBranch: true } };
  };
}>;

/** Shape required for workflow learning record creation and optimization. */
export type TaskForLearning = Prisma.TaskGetPayload<{
  include: {
    theme: { include: { category: true } };
    taskLabels: { include: { label: true } };
  };
}>;

/**
 * Resolve a Task ID to subtask info — id, parent ID and title.
 * Used to detect and propagate subtask completion to the parent task.
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Subtask info with parentId and title, or null. / parentId・title付きサブタスク情報、なければnull
 */
export async function resolveTaskSubtaskInfo(taskId: number): Promise<TaskSubtaskInfo | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      select: { id: true, parentId: true, title: true },
    })
    .catch(() => null);
}

/**
 * Resolve a Task ID to the shape required for plan auto-approve decision.
 * Includes autoApprovePlan flag and parentId for subtask detection.
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Plan approval decision fields, or null. / 自動承認判定フィールド、なければnull
 */
export async function resolveTaskForPlanApproval(
  taskId: number,
): Promise<TaskForPlanApproval | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      select: { id: true, autoApprovePlan: true, parentId: true },
    })
    .catch(() => null);
}

/**
 * Resolve a Task ID to the shape required for auto-merge candidate resolution.
 * Includes status scalars, workingDirectory, and theme workingDirectory.
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Auto-merge candidate fields, or null. / 自動マージ候補フィールド、なければnull
 */
export async function resolveTaskForAutoMerge(taskId: number): Promise<TaskForAutoMerge | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        workflowStatus: true,
        completedAt: true,
        workingDirectory: true,
        theme: { select: { workingDirectory: true, defaultBranch: true } },
      },
    })
    .catch(() => null);
}

/**
 * Confirm a Task ID's row is CONFIRMED ABSENT — as opposed to unresolvable
 * because of a transient DB error. Distinct from every `resolveXxx` helper
 * above: those collapse "no row" and "DB error" into the same null return
 * (an intentional fail-open contract many callers depend on), which makes
 * them unusable for deciding whether a queued task genuinely vanished.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns true only when the lookup succeeded and found no row; false when a
 *   row exists OR the lookup itself failed (indeterminate). / 行の不存在が確定した場合のみ true
 */
export async function taskRowConfirmedAbsent(taskId: number): Promise<boolean> {
  try {
    const row = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
    return row === null;
  } catch {
    return false;
  }
}

/**
 * Resolve a Task ID's preferred base branch for git diff/merge-base scoping.
 *
 * Prefers `theme.defaultBranch` — populated for every task via its theme and
 * kept fresh by the same code paths that decide worktree creation, PR base
 * branch, and auto-merge (execute-route.ts, post-execution-review.ts,
 * auto-merge-candidates.ts). Falls back to `AgentExecutionConfig.targetBranch`
 * (manual-settings-only, and empty for autonomous-pipeline tasks) only when
 * the theme has no default branch set.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Preferred base branch name, or null if neither source has one. / 優先ベースブランチ名、なければnull
 */
export async function resolvePreferredBaseBranch(taskId: number): Promise<string | null> {
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { theme: { select: { defaultBranch: true } } },
    })
    .catch(() => null);
  if (task?.theme?.defaultBranch) return task.theme.defaultBranch;

  const execConfig = await prisma.agentExecutionConfig
    .findUnique({ where: { taskId }, select: { targetBranch: true } })
    .catch(() => null);
  return execConfig?.targetBranch ?? null;
}

/**
 * Resolve a Task ID to the shape required for workflow learning record creation and optimization.
 * Includes theme with category and task labels with label details.
 * Does NOT include activityLogs — callers fetch those via a separate activityLog query.
 * Returns null when the task is absent or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Task with theme, category and labels, or null. / テーマ・カテゴリ・ラベル付きタスク、なければnull
 */
export async function resolveTaskForLearning(taskId: number): Promise<TaskForLearning | null> {
  return prisma.task
    .findUnique({
      where: { id: taskId },
      include: {
        theme: { include: { category: true } },
        taskLabels: { include: { label: true } },
      },
    })
    .catch(() => null);
}
