/**
 * supervision.test
 *
 * What ラピ reports when asked what needs a hand.
 *
 * The property the whole design rests on: she reports what the database
 * matched, with no model anywhere in the path, so she cannot be confidently
 * wrong about how many tasks are stuck. These tests are therefore about the
 * conditions — that each one asks for what it claims to, that finished work
 * is never counted, and that the totals are of everything matched rather
 * than of the handful of rows carried back.
 *
 * The categories are not "everything unusual". They are the states rapitas
 * does NOT recover from on its own: a task the system already retries is not
 * waiting for a person, and listing it would bury the ones that are.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** Query arguments prisma was handed, in order. */
let calls: { op: string; model: string; args: Record<string, unknown> }[] = [];
/** What count() returns, keyed by call order. */
let counts: number[] = [];
let rows: unknown[][] = [];

const model = (name: string) => ({
  count: async (args: Record<string, unknown>) => {
    calls.push({ op: 'count', model: name, args });
    return counts.shift() ?? 0;
  },
  findMany: async (args: Record<string, unknown>) => {
    calls.push({ op: 'findMany', model: name, args });
    return rows.shift() ?? [];
  },
});

mock.module('../../config/database', () => ({
  prisma: { task: model('task') },
  ensureDatabaseConnection: async () => {},
}));

const { surveyBacklog, SUPERVISION_CATEGORIES, MAX_SUPERVISION_ROWS, STALLED_AFTER_DAYS } =
  await import('./supervision');

/** Every `where` the survey built, in call order. */
const wheres = () =>
  calls.filter((c) => c.op === 'findMany').map((c) => c.args.where as Record<string, unknown>);

/** The `where` for one named category. */
const whereFor = (category: string) => {
  const index = SUPERVISION_CATEGORIES.indexOf(category as never);
  return wheres()[index];
};

beforeEach(() => {
  calls = [];
  counts = [];
  rows = [];
});

describe('what it looks for', () => {
  test('asks about every category it claims to report', async () => {
    const survey = await surveyBacklog();
    expect(survey.categories.map((c) => c.category)).toEqual([...SUPERVISION_CATEGORIES]);
  });

  // The escape from blocked is a manual retry — by design, nothing retries
  // these blindly, so they sit until someone looks.
  test('looks for blocked tasks', async () => {
    await surveyBacklog();
    expect(whereFor('blocked').status).toBe('blocked');
  });

  // Measured on this repository: a task excluded from auto-run is never
  // selected and nothing anywhere says so. One sat fifteen days.
  test('looks for tasks held out of auto-run, by either switch', async () => {
    await surveyBacklog();
    const where = whereFor('held');
    expect(where.OR).toEqual([{ autoRunExcluded: true }, { workflowDisabled: true }]);
  });

  // Measured on this backlog: 22 held, 19 of them ideas the box had filed and
  // the system had then set aside. Reporting 22 to surface the 2 that were
  // hand-filed and genuinely stuck is the burying this category exists to
  // prevent, and the operator confirmed those ideas are correctly shelved.
  test('leaves out the ideas the backlog filed and then shelved', async () => {
    await surveyBacklog();
    expect(whereFor('held').NOT).toEqual({
      autoCreatedFromBacklog: true,
      title: { startsWith: '[Idea]' },
    });
  });

  // Both halves, on purpose. The column alone would shelve auto-filed
  // concerns and bugs too, and a reported defect set aside is not the same
  // as a speculative idea set aside — one of the 22 was exactly that.
  test('still reports a concern the backlog filed and shelved', async () => {
    await surveyBacklog();
    const not = whereFor('held').NOT as { title?: { startsWith?: string } };
    expect(not.title?.startsWith).toBe('[Idea]');
  });

  // A hand-filed task excluded from auto-run is what this category is for:
  // nothing anywhere in the app says a word about it.
  test('still reports what was excluded without the backlog filing it', async () => {
    await surveyBacklog();
    const not = whereFor('held').NOT as { autoCreatedFromBacklog?: boolean };
    expect(not.autoCreatedFromBacklog).toBe(true);
  });

  // A task with no theme is invisible to auto-run, which reads as the system
  // having stopped rather than as the task being unreachable.
  test('looks for tasks with no theme to be picked from', async () => {
    await surveyBacklog();
    expect(whereFor('noTheme').themeId).toBeNull();
  });

  test('looks for work that stopped moving while in progress', async () => {
    await surveyBacklog();
    const where = whereFor('stalled');
    expect(where.status).toBe('in-progress');
    const cutoff = (where.updatedAt as { lt: Date }).lt;
    const days = (Date.now() - cutoff.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(STALLED_AFTER_DAYS);
  });

  test('looks for work past its due date', async () => {
    await surveyBacklog();
    const where = whereFor('overdue');
    expect((where.dueDate as { lt: Date }).lt).toBeInstanceOf(Date);
  });
});

describe('what it refuses to count', () => {
  // Finished work is not waiting for anyone. Counting it would make the
  // report useless on a backlog with hundreds of done tasks — this repository
  // has 226.
  test('never counts work that is already finished', async () => {
    await surveyBacklog();
    for (const where of wheres()) {
      const notIn = (where.status as { notIn?: string[] })?.notIn;
      const exact = where.status;
      expect(notIn?.includes('done') || typeof exact === 'string').toBe(true);
      if (notIn) {
        expect(notIn).toContain('done');
        expect(notIn).toContain('cancelled');
      }
    }
  });

  // Subtasks move with their parent; reporting both doubles every finding.
  test('reports parents, not their subtasks', async () => {
    await surveyBacklog();
    for (const where of wheres()) expect(where.parentId).toBeNull();
  });
});

describe('what it reports', () => {
  test('counts every match but carries only a sample', async () => {
    // The stub answers in category order, so the value has to sit at the
    // category's own index rather than first.
    const at = SUPERVISION_CATEGORIES.indexOf('blocked');
    counts = SUPERVISION_CATEGORIES.map((_, i) => (i === at ? 412 : 0));
    rows = SUPERVISION_CATEGORIES.map((_, i) =>
      i === at ? Array.from({ length: MAX_SUPERVISION_ROWS }, (__, n) => ({ id: n })) : [],
    );
    const survey = await surveyBacklog();
    const blocked = survey.categories.find((c) => c.category === 'blocked')!;
    expect(blocked.total).toBe(412);
    expect(blocked.tasks).toHaveLength(MAX_SUPERVISION_ROWS);
  });

  test('caps the rows it asks for', async () => {
    await surveyBacklog();
    for (const call of calls.filter((c) => c.op === 'findMany')) {
      expect(call.args.take).toBe(MAX_SUPERVISION_ROWS);
    }
  });

  // The oldest is the one that has been waiting longest, which is the one a
  // supervisor wants first.
  test('shows the longest-waiting first', async () => {
    await surveyBacklog();
    for (const call of calls.filter((c) => c.op === 'findMany')) {
      expect(call.args.orderBy).toEqual({ updatedAt: 'asc' });
    }
  });

  test('adds up how many need a hand in total', async () => {
    counts = [3, 4, 0, 2, 1];
    const survey = await surveyBacklog();
    expect(survey.total).toBe(10);
  });

  // "Nothing needs you" has to be sayable, or an empty report looks broken.
  test('says plainly when nothing needs a hand', async () => {
    counts = [0, 0, 0, 0, 0];
    const survey = await surveyBacklog();
    expect(survey.total).toBe(0);
    expect(survey.categories.every((c) => c.total === 0)).toBe(true);
  });
});
