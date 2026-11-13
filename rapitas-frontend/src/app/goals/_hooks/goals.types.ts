/**
 * goals.types
 *
 * Shapes the goal screens read from GET /goals and GET /goals/:id. A goal is
 * a project seen from the person's side; milestones (節目) are its steps.
 */

/** open | reached | paused — reached only via the confirm endpoint. */
export type MilestoneStatus = 'open' | 'reached' | 'paused';

/** Milestone totals and the reach rate (節目到達率). */
export interface GoalProgress {
  total: number;
  reached: number;
  paused: number;
  open: number;
  /** reached ÷ (total − paused); null when nothing is being pursued. */
  reachRate: number | null;
}

/** One milestone as the API returns it. */
export interface Milestone {
  id: number;
  name: string;
  description: string | null;
  dueDate: string | null;
  status: MilestoneStatus;
  acceptanceCriteria: string[];
  evidence: string | null;
  reachedAt: string | null;
  sortOrder: number;
  taskTotal: number;
  taskDone: number;
}

/** One row of GET /goals. */
export interface GoalSummary {
  id: number;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  progress: GoalProgress;
  nextMilestone: Pick<Milestone, 'id' | 'name' | 'dueDate'> | null;
  taskCount: number;
}

/** GET /goals/:id. */
export interface GoalDetail extends Omit<GoalSummary, 'nextMilestone'> {
  milestones: Milestone[];
  unassignedTaskCount: number;
}

/** A task of the goal that is not filed under a milestone yet. */
export interface UnassignedTask {
  id: number;
  title: string;
  status: string;
}
