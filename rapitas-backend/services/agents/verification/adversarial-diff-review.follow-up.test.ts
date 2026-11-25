/**
 * adversarial-diff-review.follow-up.test
 *
 * Drives the real reviewDiffAdversarially (task 1547): a fail that rests only
 * on impact=follow_up findings passes, the findings are filed as concerns with
 * their same-kind examples, and the event payload records them; a blocking
 * finding still fails. The task-1541 fixture is a reconstructed jury reply
 * (see its `_source`). AI and DB mocked.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const FIXTURE = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'task-1541-negation-reply.json'), 'utf8'),
) as { findings: Array<Record<string, unknown>> };

const getDiff = mock(() =>
  Promise.resolve([{ filename: 'a.ts', status: 'M', additions: 1, deletions: 0, patch: '+x' }]),
);
let replyFindings: Array<Record<string, unknown>> = [];
const sendAIMessage = mock(() =>
  Promise.resolve({ content: JSON.stringify({ verdict: 'fail', findings: replyFindings }) }),
);
const submitConcern = mock(async (_input: Record<string, unknown>) => ({
  id: 1,
  outcome: 'created',
}));
const appendEvent = mock((_e: { eventType: string; payload: Record<string, unknown> }) =>
  Promise.resolve({ id: 1 }),
);

mock.module('../orchestrator/git-operations/core/diff-structured', () => ({
  getDiff,
  resolveBaseRef: () => Promise.resolve(''),
}));
mock.module('../../../utils/ai-client', () => ({ sendAIMessage, getAuxAiMode: () => 'api' }));
mock.module('../../ai/model-tier-table/configured-vendors', () => ({
  resolveConfiguredVendors: async () => ({
    configured: ['anthropic', 'google', 'openai'],
    unconfigured: [],
  }),
}));
mock.module('../../workflow/workflow-file-utils', () => ({
  resolveWorkflowDir: mock(() => Promise.resolve({ dir: '/wf/1' })),
  readWorkflowFile: mock(() => Promise.resolve('plan content')),
}));
mock.module('../../memory/timeline', () => ({ appendEvent }));
mock.module('../../memory/concern-backlog-service', () => ({ submitConcern }));
mock.module('../../../config/database', () => ({
  prisma: {
    agentExecution: {
      findFirst: mock(() => Promise.resolve(null)),
      findMany: mock(() => Promise.resolve([{ modelName: 'claude-sonnet-5-5' }])),
    },
    agentExecutionConfig: { findUnique: mock(() => Promise.resolve(null)) },
    task: {
      findUnique: mock(() =>
        Promise.resolve({
          title: '差し戻し理由の種類別集計',
          themeId: 18,
          acceptanceCriteria: JSON.stringify(['否定の文を矛盾判定に数えない', 'テストが通る']),
        }),
      ),
    },
  },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { reviewDiffAdversarially, resetJurorHealth } = await import('./adversarial-diff-review');

const settle = () => new Promise((res) => setTimeout(res, 20));
const reviewPayload = () =>
  appendEvent.mock.calls.map((c) => c[0]).find((e) => e.eventType === 'adversarial_review')!
    .payload as { followUp?: { count: number; reasons: string[] } };

beforeEach(() => {
  resetJurorHealth();
  submitConcern.mockClear();
  appendEvent.mockClear();
});

describe('reviewDiffAdversarially — impact=follow_up findings', () => {
  it('task 1541 negation miss: follow_up, passes, and the same-kind examples come back together', async () => {
    replyFindings = FIXTURE.findings;
    const r = await reviewDiffAdversarially({ taskId: 1541, worktreePath: tmpdir() });
    expect(r.verdict).toBe('pass');
    expect(r.followUp?.count).toBe(1);
    const f = r.findings!.find((x) => x.deferred === 'follow_up')!;
    expect(f).toMatchObject({ kind: 'input_coverage', impact: 'follow_up', gating: false });
    expect(f.examples!.length).toBeGreaterThanOrEqual(4);
    await settle();
    expect(submitConcern).toHaveBeenCalledTimes(1);
    const filed = submitConcern.mock.calls[0][0];
    expect(filed).toMatchObject({
      themeId: 18,
      originTaskId: 1541,
      source: 'adversarial_review_follow_up',
    });
    const detail = String(filed.detail);
    expect(f.examples!.filter((e) => detail.includes(e)).length).toBeGreaterThanOrEqual(4);
    expect(reviewPayload().followUp?.count).toBe(1);
    expect(reviewPayload().followUp?.reasons[0]).toContain('否定');
  });

  it('a blocking finding on a criterion still fails and is not filed as follow_up', async () => {
    replyFindings = [
      {
        severity: 'major',
        criterion: '1',
        summary: 'データを消す',
        evidence: 'a.ts:1',
        impact: 'blocking',
      },
      FIXTURE.findings[0],
    ];
    const r = await reviewDiffAdversarially({ taskId: 1541, worktreePath: tmpdir() });
    expect(r.verdict).toBe('fail');
    expect(r.reasons.some((x) => x.includes('データを消す'))).toBe(true);
    expect(r.reasons.some((x) => x.includes('否定された'))).toBe(false);
    expect(r.findings!.filter((x) => x.summary === 'データを消す').every((x) => x.gating)).toBe(
      true,
    );
  });

  it('a finding without impact still fails (blocking by default)', async () => {
    const { impact: _drop, ...noImpact } = FIXTURE.findings[0];
    replyFindings = [noImpact];
    const r = await reviewDiffAdversarially({ taskId: 1541, worktreePath: tmpdir() });
    expect(r.verdict).toBe('fail');
    await settle();
    expect(submitConcern).not.toHaveBeenCalled();
  });
});
