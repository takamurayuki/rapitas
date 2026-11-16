/**
 * goal-views
 *
 * Shapes stored projects and milestones into what the goal screens read: a
 * milestone with its criteria as a list and its task counts, and a goal with
 * its milestones in order and its reach rate. Pure — no database access.
 *
 * A "goal" is a Project seen from the person's side: roadmap-commit already
 * stores the goal statement as the project's description, and milestones
 * already hang off projects, so no second hierarchy is introduced.
 */
import { goalProgress, parseMilestoneCriteria, type GoalProgress } from './milestone-achievement';

/** A milestone row as loaded for the goal screens. */
export interface StoredMilestone {
  id: number;
  name: string;
  description: string | null;
  dueDate: Date | null;
  status: string;
  acceptanceCriteria: string | null;
  evidence: string | null;
  reachedAt: Date | null;
  sortOrder: number;
  /** Top-level tasks filed under the milestone (status only). */
  tasks?: ReadonlyArray<{ status: string }>;
}

/** A milestone as the API returns it. */
export interface MilestoneView extends Omit<StoredMilestone, 'acceptanceCriteria' | 'tasks'> {
  acceptanceCriteria: string[];
  taskTotal: number;
  taskDone: number;
}

/**
 * Convert a stored milestone into its API shape.
 *
 * @param m - The stored milestone / 保存された節目
 * @returns The milestone with parsed criteria and task counts / 表示用の節目
 */
export function toMilestoneView<T extends StoredMilestone>(m: T): MilestoneView {
  const { tasks, acceptanceCriteria, ...rest } = m;
  const list = tasks ?? [];
  return {
    ...rest,
    acceptanceCriteria: parseMilestoneCriteria(acceptanceCriteria),
    taskTotal: list.length,
    taskDone: list.filter((t) => t.status === 'done').length,
  };
}

/** A project row as loaded for the goal screens. */
export interface StoredGoal {
  id: number;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  milestones: StoredMilestone[];
  _count: { tasks: number };
}

/** One row of the goal list. */
export interface GoalSummary {
  id: number;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  progress: GoalProgress;
  /** The first milestone still open, in the goal's order. */
  nextMilestone: Pick<MilestoneView, 'id' | 'name' | 'dueDate'> | null;
  taskCount: number;
}

/**
 * Summarise a goal for the goal list.
 *
 * @param goal - The stored project with its milestones (in order) / 節目付きのプロジェクト
 * @returns The list row / 一覧用の要約
 */
export function toGoalSummary(goal: StoredGoal): GoalSummary {
  const next = goal.milestones.find((m) => m.status === 'open');
  return {
    id: goal.id,
    name: goal.name,
    description: goal.description,
    color: goal.color,
    icon: goal.icon,
    progress: goalProgress(goal.milestones),
    nextMilestone: next ? { id: next.id, name: next.name, dueDate: next.dueDate } : null,
    taskCount: goal._count.tasks,
  };
}

/** The goal detail screen's data. */
export interface GoalDetail extends Omit<GoalSummary, 'nextMilestone'> {
  milestones: MilestoneView[];
  /** Tasks of the goal not filed under any milestone yet. */
  unassignedTaskCount: number;
}

/**
 * Build the goal detail view.
 *
 * @param goal - The stored project with milestones (in order) / 節目付きのプロジェクト
 * @param unassignedTaskCount - Its tasks without a milestone / 節目未設定のタスク数
 * @returns The detail view / 詳細表示用データ
 */
export function toGoalDetail(goal: StoredGoal, unassignedTaskCount: number): GoalDetail {
  const { nextMilestone: _next, ...summary } = toGoalSummary(goal);
  return {
    ...summary,
    milestones: goal.milestones.map(toMilestoneView),
    unassignedTaskCount,
  };
}

/** Prisma orderBy for milestones: the person's order, then creation. */
export const MILESTONE_ORDER = [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }];
