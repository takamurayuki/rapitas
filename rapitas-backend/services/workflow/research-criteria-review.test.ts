/**
 * research-criteria-review.test
 *
 * The researcher's criteria review settles the criteria before the plan
 * (#1561): a person's task stops at awaiting_question and resumes at
 * research_done without running research again; the system's own task adopts
 * the rewrite; an ok, a missing block or a resumed task goes on.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

type Row = Record<string, unknown>;
let row: Row | null = null;
const taskUpdate = mock(async (_a: unknown) => ({}));
mock.module('../../config', () => ({
  prisma: { task: { findUnique: async () => row, update: taskUpdate } },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
const written: Array<{ type: string; body: string }> = [];
mock.module('./workflow-file-utils', () => ({
  writeWorkflowFile: async (_id: number, type: string, body: string) => {
    written.push({ type, body });
  },
}));
const recordTransition = mock(async (_p: Record<string, unknown>) => undefined);
mock.module('./transition-recorder', () => ({ recordTransition }));
mock.module('../communication/notification-service', () => ({
  notifyIntakeQuestionPending: async () => undefined,
}));
const writeTaskCriteria = mock(async (_db: unknown, _input: Record<string, unknown>) => ({
  ok: true,
  revision: 'rev-after',
}));
mock.module('../task/task-criteria-write', () => ({ writeTaskCriteria }));

const { settleCriteriaFromResearch, RESEARCH_CRITERIA_CAUSES } =
  await import('./research-criteria-review');

const task = (over: Row = {}): Row => ({
  id: 7,
  title: 'ログに理由を残す',
  workflowStatus: 'research_done',
  acceptanceCriteria: '["dev-pull.test.cjs のテストが通る"]',
  autoCreatedFromBacklog: false,
  agentGenerated: false,
  theme: { isDevelopment: true },
  ...over,
});

const research = (block: object | null) =>
  ['# 調査', '## 完了条件の点検', '...'].join('\n') +
  (block ? `\n\`\`\`json criteria-review\n${JSON.stringify(block)}\n\`\`\`\n` : '');

const REVISE = {
  verdict: 'revise',
  findings: [{ index: 0, kind: 'unverifiable', problem: '12件が変更前から落ちる' }],
  proposed: ['変更前に通っていたテストが変更後も通る'],
};
const causes = () => recordTransition.mock.calls.map((c) => c[0].cause);

beforeEach(() => {
  row = task();
  written.length = 0;
  taskUpdate.mockClear();
  recordTransition.mockClear();
  writeTaskCriteria.mockClear();
});

describe('a person’s task', () => {
  it('stops before the plan, asking with the findings and the rewrite', async () => {
    expect(await settleCriteriaFromResearch(7, research(REVISE))).toBe(true);
    expect(written[0].type).toBe('question');
    expect(written[0].body).toContain('12件が変更前から落ちる');
    expect(written[0].body).toContain('変更前に通っていたテストが変更後も通る');
    expect(taskUpdate.mock.calls[0][0]).toMatchObject({
      data: { workflowStatus: 'awaiting_question' },
    });
    expect(writeTaskCriteria).not.toHaveBeenCalled();
  });

  // The answer must return to research_done: a spec_change answer resets to
  // draft and would run the research again.
  it('resumes at research_done once answered, not at draft', async () => {
    await settleCriteriaFromResearch(7, research(REVISE));
    const q = recordTransition.mock.calls.find(
      (c) => c[0].cause === RESEARCH_CRITERIA_CAUSES.question,
    )?.[0];
    expect(q).toMatchObject({ toStatus: 'awaiting_question' });
    expect(q?.metadata).toMatchObject({
      previousStatus: 'research_done',
      kind: 'execution_continuation',
    });
  });
});

describe('a task the system filed', () => {
  it('adopts the rewrite and goes on', async () => {
    row = task({ autoCreatedFromBacklog: true });
    expect(await settleCriteriaFromResearch(7, research(REVISE))).toBe(false);
    expect(writeTaskCriteria.mock.calls[0][1].next).toEqual({
      acceptanceCriteria: REVISE.proposed,
    });
    expect(causes()).toContain(RESEARCH_CRITERIA_CAUSES.adopted);
    expect(written).toEqual([]);
  });
});

describe('going on', () => {
  it('records an ok and goes on', async () => {
    expect(
      await settleCriteriaFromResearch(7, research({ verdict: 'ok', findings: [], proposed: [] })),
    ).toBe(false);
    expect(causes()).toEqual([RESEARCH_CRITERIA_CAUSES.reviewed]);
  });

  it('goes on when research.md carries no review', async () => {
    expect(await settleCriteriaFromResearch(7, research(null))).toBe(false);
    expect(causes()).toEqual([]);
  });

  // Already asked (HTTP save) or resumed: the CLI epilogue must not ask again.
  it('does nothing unless the task has just settled at research_done', async () => {
    row = task({ workflowStatus: 'awaiting_question' });
    expect(await settleCriteriaFromResearch(7, research(REVISE))).toBe(false);
    expect(written).toEqual([]);
  });
});
