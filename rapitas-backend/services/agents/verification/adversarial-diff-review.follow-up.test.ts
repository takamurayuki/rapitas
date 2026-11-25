/**
 * adversarial-diff-review.follow-up.test
 *
 * Drives the real reviewDiffAdversarially (task 1547): a fail that rests only
 * on impact=follow_up findings passes, the findings are filed as concerns with
 * their same-kind examples, and the event payload records them; a blocking
 * finding still fails, and so does a fail that keeps a dispute the verifier
 * could not decide (R1). The task-1541 fixture replays the finding recorded on
 * transition 22030 unchanged (`recorded`), plus the hand-added kind / impact /
 * examples kept apart in `annotations` (see its `_source`). AI and DB mocked.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

type Fixture = {
  _source: { taskId: number; transitionId: number; endpoint: string; selection: string };
  recorded: { reason: string; findings: Array<Record<string, unknown>> };
  annotations: { kind: string; impact: string; examples: string[]; _rationale: string[] };
};
const FIXTURE = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'task-1541-negation-reply.json'), 'utf8'),
) as Fixture;
const RECORDED = FIXTURE.recorded.findings[0];
/** The juror-written fields of the recorded finding (seat / verifier fields are the panel's). */
const JUROR_FIELDS = ['severity', 'criterion', 'summary', 'evidence', 'repro'] as const;
const recordedReply = Object.fromEntries(JUROR_FIELDS.map((k) => [k, RECORDED[k]]));
const { kind, impact, examples } = FIXTURE.annotations;
const REPLAYED = { ...recordedReply, kind, impact, examples };

const getDiff = mock(() =>
  Promise.resolve([{ filename: 'a.ts', status: 'M', additions: 1, deletions: 0, patch: '+x' }]),
);
let replyFindings: Array<Record<string, unknown>> = [];
/** Per-reviewer replies in call order; when empty both reviewers get replyFindings. */
let reviewerReplies: Array<Record<string, unknown>> = [];
let verifierReply = '';
const sendAIMessage = mock((req: { systemPrompt?: string }) => {
  if (String(req?.systemPrompt ?? '').includes('verifier')) {
    return Promise.resolve({ content: verifierReply });
  }
  const next = reviewerReplies.shift() ?? { verdict: 'fail', findings: replyFindings };
  return Promise.resolve({ content: JSON.stringify(next) });
});
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
  reviewerReplies = [];
  verifierReply = '';
  resetJurorHealth();
  submitConcern.mockClear();
  appendEvent.mockClear();
});

describe('reviewDiffAdversarially — impact=follow_up findings', () => {
  it('the fixture is transition 22030 of task 1541, its recorded fields replayed unchanged', () => {
    expect(FIXTURE._source).toMatchObject({ taskId: 1541, transitionId: 22030 });
    expect(FIXTURE.recorded.reason.startsWith('差分レビュー不合格: 受入基準1: [major]')).toBe(true);
    expect(FIXTURE.recorded.reason).toContain(String(RECORDED.summary));
    for (const k of JUROR_FIELDS) expect(REPLAYED[k]).toEqual(RECORDED[k]);
    expect(RECORDED).not.toHaveProperty('impact');
    expect(RECORDED).not.toHaveProperty('examples');
    expect(FIXTURE.annotations._rationale.length).toBeGreaterThanOrEqual(2);
  });

  it('task 1541 negation miss: follow_up, passes, and the same-kind examples come back together', async () => {
    replyFindings = [REPLAYED];
    const r = await reviewDiffAdversarially({ taskId: 1541, worktreePath: tmpdir() });
    expect(r.verdict).toBe('pass');
    expect(r.followUp?.count).toBe(1);
    const f = r.findings!.find((x) => x.deferred === 'follow_up')!;
    expect(f).toMatchObject({ kind: 'input_coverage', impact: 'follow_up', gating: false });
    expect(f.examples).toEqual(examples);
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
    for (const e of examples) expect(detail).toContain(e);
    expect(detail).toContain(String(RECORDED.summary));
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
      REPLAYED,
    ];
    const r = await reviewDiffAdversarially({ taskId: 1541, worktreePath: tmpdir() });
    expect(r.verdict).toBe('fail');
    expect(r.reasons.some((x) => x.includes('データを消す'))).toBe(true);
    expect(r.reasons.some((x) => x.includes('否定文でも'))).toBe(false);
    expect(r.findings!.filter((x) => x.summary === 'データを消す').every((x) => x.gating)).toBe(
      true,
    );
  });

  it('a finding without impact still fails (blocking by default)', async () => {
    replyFindings = [{ ...recordedReply, kind, examples }];
    const r = await reviewDiffAdversarially({ taskId: 1541, worktreePath: tmpdir() });
    expect(r.verdict).toBe('fail');
    await settle();
    expect(submitConcern).not.toHaveBeenCalled();
  });

  it('R1: an undetermined blocker next to an upheld follow_up keeps the fail and files nothing', async () => {
    const blocker = {
      severity: 'blocker',
      criterion: '2',
      summary: 'データを消す',
      evidence: 'a.ts:9',
      impact: 'blocking',
    };
    reviewerReplies = [
      { verdict: 'fail', findings: [REPLAYED, blocker] },
      { verdict: 'pass', findings: [] },
    ];
    verifierReply = JSON.stringify({ results: [{ index: 1, status: 'holds', note: 'n' }] });
    const r = await reviewDiffAdversarially({ taskId: 1541, worktreePath: tmpdir() });
    expect(r.verdict).toBe('fail');
    expect(r.followUp).toBeUndefined();
    expect(r.findings!.find((x) => x.summary === 'データを消す')?.verification).toBe(
      'undetermined',
    );
    await settle();
    expect(submitConcern).not.toHaveBeenCalled();
  });
});
