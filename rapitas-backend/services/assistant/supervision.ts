/**
 * Supervision
 *
 * What in the backlog is waiting for a person.
 *
 * rapitas already watches itself in a dozen places — blocked escalation,
 * queue-stall policy, the no-selection watch, CI watch, the self-incident
 * watcher, the growth and daily-report jobs. What none of them do is answer
 * "where should I look right now" in one place. That is the gap this fills,
 * and it fills it by reading, not by acting.
 *
 * The categories are deliberately NOT "everything unusual". They are the
 * states rapitas does not recover from on its own. A task the system already
 * retries is not waiting for anybody, and listing it would bury the ones
 * that are — which is the failure mode of every status dashboard that shows
 * you a hundred rows.
 *
 * No model is involved anywhere. Every number here is a `count` the database
 * ran, so ラピ can be asked the wrong question but cannot be confidently
 * wrong about how many tasks are stuck.
 *
 * Reads only. Not responsible for doing anything about what it finds.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const logger = createLogger('assistant-supervision');

/** Most rows a category carries. A survey is not a task list. */
export const MAX_SUPERVISION_ROWS = 10;

/**
 * How long in-progress work may go untouched before it is stalled.
 *
 * Two days rather than hours: a phase can legitimately run long, and the
 * watchers that care about minutes already exist. This is for the ones that
 * quietly stopped.
 */
export const STALLED_AFTER_DAYS = 2;

/** Statuses that are over. Nothing finished is waiting for anyone. */
const TERMINAL = ['done', 'cancelled'] as const;

/**
 * What ラピ looks for, in the order she reports it.
 *
 * Ordered by how silent the state is rather than by severity: `held` and
 * `noTheme` are first because nothing in the app says a word about them,
 * while an overdue task at least shows a date on its card.
 */
export const SUPERVISION_CATEGORIES = [
  /** Excluded from auto-run by either switch, so never selected. */
  'held',
  /** No theme, so invisible to auto-run's selection entirely. */
  'noTheme',
  /** Blocked, which by design is not retried blindly. */
  'blocked',
  /** In progress, but nothing has touched it for days. */
  'stalled',
  /** Past its due date and not finished. */
  'overdue',
] as const;

export type SupervisionCategory = (typeof SUPERVISION_CATEGORIES)[number];

export interface SupervisedTask {
  id: number;
  title: string;
  status: string;
  themeId: number | null;
  dueDate: Date | null;
  updatedAt: Date;
}

export interface SupervisionFinding {
  category: SupervisionCategory;
  /** Everything that matched, not the rows carried back. */
  total: number;
  tasks: SupervisedTask[];
}

export interface SupervisionSurvey {
  /** How many tasks need a hand across every category. */
  total: number;
  categories: SupervisionFinding[];
  checkedAt: Date;
}

/** The columns a finding shows. Narrow on purpose: this is a survey. */
const SELECT = {
  id: true,
  title: true,
  status: true,
  themeId: true,
  dueDate: true,
  updatedAt: true,
} as const;

/** Conditions shared by every category, so none of them can drift. */
function common(): Record<string, unknown> {
  return {
    // Subtasks move with their parent, so reporting both doubles every
    // finding and makes a split task look like several problems.
    parentId: null,
  };
}

/** What each category asks the database for. */
function conditionFor(category: SupervisionCategory, now: Date): Record<string, unknown> {
  const notFinished = { notIn: [...TERMINAL] };

  switch (category) {
    case 'held':
      return {
        ...common(),
        status: notFinished,
        OR: [{ autoRunExcluded: true }, { workflowDisabled: true }],
      };
    case 'noTheme':
      return { ...common(), status: notFinished, themeId: null };
    case 'blocked':
      // An exact status, so the terminal exclusion is implicit.
      return { ...common(), status: 'blocked' };
    case 'stalled':
      return {
        ...common(),
        status: 'in-progress',
        updatedAt: { lt: new Date(now.getTime() - STALLED_AFTER_DAYS * 86_400_000) },
      };
    case 'overdue':
      return { ...common(), status: notFinished, dueDate: { lt: now } };
  }
}

/**
 * Look over the whole backlog and report what is waiting for a person.
 *
 * @returns Each category's real total and a sample of its tasks / 各分類の総数と一部のタスク
 */
export async function surveyBacklog(): Promise<SupervisionSurvey> {
  const now = new Date();

  const categories = await Promise.all(
    SUPERVISION_CATEGORIES.map(async (category) => {
      const where = conditionFor(category, now);
      const [total, tasks] = await Promise.all([
        prisma.task.count({ where }),
        prisma.task.findMany({
          where,
          // Oldest first: the one that has been waiting longest is the one a
          // supervisor wants to see.
          orderBy: { updatedAt: 'asc' },
          take: MAX_SUPERVISION_ROWS,
          select: SELECT,
        }),
      ]);
      return { category, total, tasks: tasks as SupervisedTask[] };
    }),
  );

  const total = categories.reduce((sum, c) => sum + c.total, 0);
  logger.info(
    { total, byCategory: categories.map((c) => `${c.category}=${c.total}`).join(' ') },
    'backlog surveyed',
  );

  return { total, categories, checkedAt: now };
}
