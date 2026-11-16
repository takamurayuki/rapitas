/**
 * intake-gate.criteria-race.test
 *
 * The intake enrichment against a person's edit made while the AI call is in
 * flight, on a real SQLite database (companion design 4.5.1): the enrichment
 * is bound to the revision read at the start of the gate, so a change that
 * lands meanwhile is kept and the enrichment is discarded — never a merge of
 * the old lists written over it.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  installSqliteJuryHarness,
  seedJudgeableTask,
} from '../workflow/jury-review-run.sqlite.test-helpers';

const { db, dispose } = installSqliteJuryHarness();

/** Runs inside the AI call — the person's edit, if the test sets one. */
let duringDerive: (() => Promise<void>) | null = null;
const deriveTaskSpec = mock(async () => {
  if (duringDerive) await duringDerive();
  return {
    spec: {
      goals: ['AI が補った目標'],
      constraints: ['AI が補った制約'],
      acceptanceCriteria: ['AI が補った条件'],
    },
    source: 'ai' as const,
  };
});
// Every export is mirrored (bun replaces the whole module); only the I/O is stubbed.
const deriver = { ...(await import('../task/task-spec-deriver')) };
mock.module('../task/task-spec-deriver', () => ({
  ...deriver,
  deriveTaskSpec,
  generateIntakeQuestions: async () => [],
}));
const files = { ...(await import('../workflow/workflow-file-utils')) };
mock.module('../workflow/workflow-file-utils', () => ({
  ...files,
  resolveWorkflowDir: async () => ({ dir: '/wf' }),
  readWorkflowFile: async () => null,
  writeWorkflowFile: async () => '/wf/question.md',
}));
const recorder = { ...(await import('../workflow/transition-recorder')) };
mock.module('../workflow/transition-recorder', () => ({
  ...recorder,
  recordTransition: async () => {},
}));
const notifications = { ...(await import('../communication/notification-service')) };
mock.module('../communication/notification-service', () => ({
  ...notifications,
  createNotification: async () => {},
  notifyIntakeQuestionPending: async () => ({ id: 1 }),
}));

const { ensureIntakeReady } = await import('./intake-gate');

afterAll(dispose);

/** A thin spec the gate will try to enrich. */
const seedThinTask = () =>
  seedJudgeableTask(db, {
    status: 'todo',
    workflowStatus: 'draft',
    description: '一覧画面にキーワード検索を足したい。'.repeat(3),
    goals: null,
    constraints: null,
    acceptanceCriteria: null,
  });

describe('intake enrichment vs. a person editing the criteria meanwhile', () => {
  beforeEach(() => {
    duringDerive = null;
  });

  test('no edit in between → the enrichment is written', async () => {
    const taskId = await seedThinTask();
    await ensureIntakeReady(taskId);
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.acceptanceCriteria).toBe(JSON.stringify(['AI が補った条件']));
  });

  test('an edit during the AI call is kept; the enrichment is discarded', async () => {
    const taskId = await seedThinTask();
    duringDerive = async () => {
      await db.task.update({
        where: { id: taskId },
        data: { acceptanceCriteria: JSON.stringify(['人が書いた条件']) },
      });
    };
    await ensureIntakeReady(taskId);
    expect(deriveTaskSpec).toHaveBeenCalled();
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.acceptanceCriteria).toBe(JSON.stringify(['人が書いた条件']));
    expect(row.goals).toBeNull();
    expect(row.constraints).toBeNull();
  });
});
