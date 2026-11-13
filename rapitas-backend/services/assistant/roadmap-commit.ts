/**
 * RoadmapCommit
 *
 * Creating what the user approved: a theme if the plan asked for one, a
 * project if it asked for one, its milestones (節目) under that project, and
 * a task per step filed under its milestone.
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
 * Each task is created together with its TaskCompanion row (one insert), so
 * when the loop stops partway every task it did make is still accompanied.
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
import { normalizeCriteria } from './criteria-text';

const logger = createLogger('assistant-roadmap-commit');

/** Where a step's work goes, as the approved plan states it. */
export type ApprovedPlacement =
  | { kind: 'existing'; id: number; name?: string }
  | { kind: 'new'; name: string; reason?: string }
  | { kind: 'none'; reason?: string };

export interface ApprovedStep {
  title: string;
  description: string;
  /**
   * What done means for this step, as the user approved it. Written to
   * `Task.acceptanceCriteria` — the column the jury, the self-check and the
   * landing classifier read — not only into the description's checklist.
   */
  acceptanceCriteria: string[];
  /**
   * The approved checks only the person can make, written to
   * `Task.userAcceptanceChecks` and never to the jury's column (design 4.1 案1).
   */
  userAcceptanceChecks?: string[];
  /** When it should be finished, as the approved plan dated it (YYYY-MM-DD). */
  dueDate?: string;
  /** Index into `ApprovedPlan.milestones` of the milestone this step builds towards. */
  milestoneIndex?: number;
}

/** A milestone (節目) as the user approved it. */
export interface ApprovedMilestone {
  name: string;
  /** What must be true to call it reached — Milestone.acceptanceCriteria. */
  acceptanceCriteria: string[];
  /** Target date (YYYY-MM-DD), when the plan dated it. */
  dueDate?: string;
}

export interface ApprovedPlan {
  goal: string;
  themeChoice: ApprovedPlacement;
  projectChoice: ApprovedPlacement;
  steps: ApprovedStep[];
  /** Created under the project only; ignored when the plan has none. */
  milestones?: ApprovedMilestone[];
}

export interface RoadmapResult {
  /** The theme the tasks went into, if any. */
  themeId: number | null;
  /** The project they were filed under, if any. */
  projectId: number | null;
  /** Every task created, in plan order. */
  taskIds: number[];
  /** Every milestone created, in plan order. */
  milestoneIds: number[];
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
 * Create the approved milestones under a project, after the ones it has.
 *
 * @param projectId - The goal's project / ゴールのプロジェクト
 * @param milestones - The approved milestones, in order / 承認された節目
 * @returns The created ids, in plan order / 作成した節目のID
 */
async function createMilestones(
  projectId: number,
  milestones: ApprovedMilestone[],
): Promise<number[]> {
  if (milestones.length === 0) return [];
  // An existing goal may already have milestones; a roadmap adds the next
  // stages after them rather than interleaving with the person's order.
  const last = await prisma.milestone.findFirst({
    where: { projectId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  const base = last ? last.sortOrder + 1 : 0;
  const ids: number[] = [];
  for (const [i, m] of milestones.entries()) {
    const made = await prisma.milestone.create({
      data: {
        projectId,
        name: m.name,
        acceptanceCriteria: JSON.stringify(normalizeCriteria(m.acceptanceCriteria)),
        ...(m.dueDate ? { dueDate: new Date(m.dueDate) } : {}),
        sortOrder: base + i,
      },
    });
    ids.push(made.id);
  }
  return ids;
}

/**
 * Create the theme, project, milestones and tasks an approved plan describes.
 *
 * @param plan - Exactly what the user confirmed / ユーザーが承認した計画
 * @returns What was created, and where it stopped if it did / 作成結果
 */
export async function commitRoadmap(plan: ApprovedPlan): Promise<RoadmapResult> {
  if (plan.steps.length === 0) {
    // Nothing to place the work in matters when there is no work. Creating a
    // theme for an empty plan would leave debris behind a no-op.
    return { themeId: null, projectId: null, taskIds: [], milestoneIds: [], failedAfter: null };
  }

  const themeId = await resolve(plan.themeChoice, (name) =>
    prisma.theme.create({ data: { name, description: plan.goal } }),
  );
  const projectId = await resolve(plan.projectChoice, (name) =>
    prisma.project.create({ data: { name, description: plan.goal } }),
  );

  // Before any task, so a task is never filed under a milestone that does not exist yet.
  const milestoneIds =
    projectId !== null ? await createMilestones(projectId, plan.milestones ?? []) : [];

  const taskIds: number[] = [];
  let failedAfter: number | null = null;

  for (const step of plan.steps) {
    try {
      const task = await createTask(prisma, {
        title: step.title,
        description: step.description,
        // Omitted rather than nulled when the plan carried no date: a null
        // would be an instruction to clear one, and there is none to clear.
        ...(step.dueDate ? { dueDate: step.dueDate } : {}),
        ...(themeId !== null ? { themeId } : {}),
        ...(projectId !== null ? { projectId } : {}),
        ...(step.milestoneIndex !== undefined && milestoneIds[step.milestoneIndex] !== undefined
          ? { milestoneId: milestoneIds[step.milestoneIndex] }
          : {}),
        acceptanceCriteria: step.acceptanceCriteria,
        ...(step.userAcceptanceChecks?.length
          ? { userAcceptanceChecks: step.userAcceptanceChecks }
          : {}),
        companion: { origin: 'roadmap_commit' },
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

  logger.info(
    { themeId, projectId, milestones: milestoneIds.length, created: taskIds.length, failedAfter },
    'roadmap committed',
  );
  return { themeId, projectId, taskIds, milestoneIds, failedAfter };
}
