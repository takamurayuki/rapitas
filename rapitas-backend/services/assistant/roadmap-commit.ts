/**
 * RoadmapCommit
 *
 * Creating what the user approved: a theme if the plan asked for one, a
 * project if it asked for one, and a task per step.
 *
 * **No model runs here.** What gets created is exactly the plan that was on
 * screen, which is the whole reason a model was allowed to draft it: the
 * drafting half can be wrong and cost nothing, because this half only does
 * what the user has already read and confirmed.
 *
 * Themes and projects are created independently rather than nested. A task
 * carries `themeId` and `projectId` side by side with no relation between
 * them — a theme is where the work happens, a project is which body of work
 * it belongs to — so "make a theme" and "make a project" are two decisions
 * the plan answers separately.
 *
 * Partial failure is reported rather than hidden. Half a roadmap is worse
 * than none if the caller cannot tell which half: they would have to read
 * the plan against the backlog to find out what is missing.
 *
 * Not responsible for deciding the plan — see `roadmap-draft.ts`.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createTask } from '../task/task-mutations';

const logger = createLogger('assistant-roadmap-commit');

/** Where a step's work goes, as the approved plan states it. */
export type ApprovedPlacement =
  | { kind: 'existing'; id: number; name?: string }
  | { kind: 'new'; name: string; reason?: string }
  | { kind: 'none'; reason?: string };

export interface ApprovedStep {
  title: string;
  description: string;
}

export interface ApprovedPlan {
  goal: string;
  themeChoice: ApprovedPlacement;
  projectChoice: ApprovedPlacement;
  steps: ApprovedStep[];
}

export interface RoadmapResult {
  /** The theme the tasks went into, if any. */
  themeId: number | null;
  /** The project they were filed under, if any. */
  projectId: number | null;
  /** Every task created, in plan order. */
  taskIds: number[];
  /**
   * How many steps were created before something went wrong, or null when
   * nothing did. Zero is a real answer: it failed on the very first one.
   */
  failedAfter: number | null;
}

/**
 * Resolve a placement into an id, creating the thing if the plan said to.
 *
 * @param placement - What the approved plan chose / 承認された配置
 * @param create - Makes the row when the plan asked for a new one / 新規作成
 * @returns The id to file against, or null / 紐づけるID（無ければ null）
 */
async function resolve(
  placement: ApprovedPlacement,
  create: (name: string) => Promise<{ id: number }>,
): Promise<number | null> {
  if (placement.kind === 'existing') return placement.id;
  if (placement.kind === 'new' && placement.name.trim()) {
    const made = await create(placement.name.trim());
    return made.id;
  }
  return null;
}

/**
 * Create the theme, project and tasks an approved plan describes.
 *
 * @param plan - Exactly what the user confirmed / ユーザーが承認した計画
 * @returns What was created, and where it stopped if it did / 作成結果
 */
export async function commitRoadmap(plan: ApprovedPlan): Promise<RoadmapResult> {
  if (plan.steps.length === 0) {
    // Nothing to place the work in matters when there is no work. Creating a
    // theme for an empty plan would leave debris behind a no-op.
    return { themeId: null, projectId: null, taskIds: [], failedAfter: null };
  }

  const themeId = await resolve(plan.themeChoice, (name) =>
    prisma.theme.create({ data: { name, description: plan.goal } }),
  );
  const projectId = await resolve(plan.projectChoice, (name) =>
    prisma.project.create({ data: { name, description: plan.goal } }),
  );

  const taskIds: number[] = [];
  let failedAfter: number | null = null;

  for (const step of plan.steps) {
    try {
      const task = await createTask(prisma, {
        title: step.title,
        description: step.description,
        ...(themeId !== null ? { themeId } : {}),
        ...(projectId !== null ? { projectId } : {}),
      });
      if (task) taskIds.push(task.id);
    } catch (err) {
      // Stop rather than carry on: the steps are ordered, and filing the
      // later ones without the earlier would leave a plan nobody can follow.
      logger.error({ err, after: taskIds.length, title: step.title }, 'roadmap stopped partway');
      failedAfter = taskIds.length;
      break;
    }
  }

  logger.info({ themeId, projectId, created: taskIds.length, failedAfter }, 'roadmap committed');
  return { themeId, projectId, taskIds, failedAfter };
}
