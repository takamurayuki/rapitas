/**
 * adversarial-diff-review.capture-1541.test
 *
 * Acceptance criterion 5 of task 1547: a real review seat, shown task 1541's
 * diff with the negation miss (a reconstruction, see the fixture's
 * `_capture.reconstruction`), put that miss on follow_up and listed same-kind
 * counterexamples. The fixture holds the seat's raw reply unchanged; this test
 * replays it through the production path (parse → two seats → post-filters →
 * concern filing) with only the AI call and the DB mocked. Nothing is
 * hand-added: kind, impact and examples come from the recorded reply.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

type Capture = {
  _capture: {
    reconstruction: {
      reconstructed: boolean;
      sourceTransitionId: number;
      sourceField: string;
      revertedDiff: string;
      reproductionCheck: Array<{ check: number; reconstructed?: string }>;
    };
    input: { taskId: number; sourceTransitionId: number; commit: string };
    model: { provider: string; model: string };
    capturedAt: string;
    script: string;
    attempts: Array<{ attempt: number; result: string }>;
    rawReplySha256: string;
  };
  rawReply: string;
};
const RAW = readFileSync(
  join(import.meta.dir, 'fixtures', 'task-1541-negation-capture.json'),
  'utf8',
);
const FIXTURE = JSON.parse(RAW) as Capture;
const NEGATION_RE = /否定|なかった|ません|ない/;

const getDiff = mock(() =>
  Promise.resolve([{ filename: 'a.ts', status: 'M', additions: 1, deletions: 0, patch: '+x' }]),
);
const sendAIMessage = mock(() => Promise.resolve({ content: FIXTURE.rawReply }));
const submitConcern = mock(async (_input: Record<string, unknown>) => ({
  id: 1,
  outcome: 'created',
}));

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
mock.module('../../memory/timeline', () => ({
  appendEvent: mock(() => Promise.resolve({ id: 1 })),
}));
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
          title: '差し戻しの理由を種類別に毎週集計する',
          themeId: 18,
          acceptanceCriteria: JSON.stringify(['否定の文を矛盾判定に数えない', 'b', 'c']),
        }),
      ),
    },
  },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { reviewDiffAdversarially, resetJurorHealth } = await import('./adversarial-diff-review');

beforeEach(() => {
  resetJurorHealth();
  submitConcern.mockClear();
});

describe('task 1541 capture — the fixture is a recorded reply', () => {
  it('has only _capture (first) and rawReply, and nothing hand-added', () => {
    expect(Object.keys(FIXTURE)).toEqual(['_capture', 'rawReply']);
    expect(RAW.trimStart().startsWith('{\n  "_capture"')).toBe(true);
  });

  it('rawReply is unchanged since capture', () => {
    const sha = createHash('sha256').update(FIXTURE.rawReply).digest('hex');
    expect(sha).toBe(FIXTURE._capture.rawReplySha256);
  });

  it('records the source, model, time, attempts, script and the reconstruction', () => {
    const c = FIXTURE._capture;
    expect(c.input).toMatchObject({ taskId: 1541, sourceTransitionId: 22030, commit: '3d770fba3' });
    expect(c.model.model).toBeTruthy();
    expect(Number.isNaN(Date.parse(c.capturedAt))).toBe(false);
    expect(c.script).toBe('scripts/capture-jury-reply-1541.ts');
    expect(c.attempts.length).toBeGreaterThanOrEqual(1);
    expect(c.attempts.length).toBeLessThanOrEqual(3);
    expect(c.reconstruction).toMatchObject({
      reconstructed: true,
      sourceTransitionId: 22030,
      sourceField: 'metadata.reason',
    });
    expect(c.reconstruction.revertedDiff).toContain('矛盾して\\s*(いない|いません|ない)');
    expect(c.reconstruction.reproductionCheck.find((r) => r.check === 1)?.reconstructed).toBe(
      'verify_contradiction',
    );
  });
});

describe('task 1541 capture — replayed through the production path', () => {
  it('同じ種類の反例が 2 件以上返り、否定の指摘は follow_up に回って起票される', async () => {
    const r = await reviewDiffAdversarially({ taskId: 1541, worktreePath: tmpdir() });
    const target = (r.findings ?? []).filter(
      (f) =>
        f.criterion === '受入基準1' &&
        [f.summary, f.evidence ?? '', ...(f.examples ?? [])].some((s) => NEGATION_RE.test(s)),
    );
    expect(target.length).toBeGreaterThan(0);
    for (const f of target) {
      expect(f).toMatchObject({ deferred: 'follow_up', gating: false });
      expect(f.examples?.length ?? 0).toBeGreaterThanOrEqual(2);
    }
    expect(r.followUp?.count).toBeGreaterThanOrEqual(1);
    await new Promise((res) => setTimeout(res, 20));
    const filed = submitConcern.mock.calls
      .map((c) => c[0])
      .find((c) => c.source === 'adversarial_review_follow_up');
    expect(filed).toBeDefined();
    const detail = String(filed!.detail);
    for (const e of target[0].examples ?? []) expect(detail).toContain(e);
  });
});
