/**
 * adversarial-diff-review.out-of-criteria.test
 *
 * Drives the real reviewDiffAdversarially: a major finding outside every
 * acceptance criterion must pass the review and be filed as a concern, while a
 * finding on a named criterion still fails it (trendline task 1519,
 * 2026-11-21). AI and DB mocked.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { tmpdir } from 'os';

const getDiff = mock(() =>
  Promise.resolve([
    { filename: 'scripts/dev-all.mjs', status: 'M', additions: 1, deletions: 0, patch: '+x' },
  ]),
);
let replyFindings: Array<Record<string, unknown>> = [];
const sendAIMessage = mock(() =>
  Promise.resolve({ content: JSON.stringify({ verdict: 'fail', findings: replyFindings }) }),
);
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
          title: 'stop-all の対象を絞る',
          themeId: 18,
          acceptanceCriteria: JSON.stringify(['PID ファイルの PID だけを止める', 'テストが通る']),
        }),
      ),
    },
  },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { reviewDiffAdversarially, resetJurorHealth } = await import('./adversarial-diff-review');

const RACE = {
  severity: 'major',
  summary: '複数の dev-all を起動すると、先に終了した側が後の PID ファイルを消す',
  evidence: 'scripts/dev-all.mjs:40',
};

beforeEach(() => {
  resetJurorHealth();
  submitConcern.mockClear();
});

describe('reviewDiffAdversarially — findings outside the acceptance criteria', () => {
  it('passes the review and files the finding as a concern', async () => {
    replyFindings = [RACE];
    const r = await reviewDiffAdversarially({ taskId: 1519, worktreePath: tmpdir() });
    expect(r.verdict).toBe('pass');
    await new Promise((res) => setTimeout(res, 20));
    expect(submitConcern).toHaveBeenCalled();
    expect(submitConcern.mock.calls[0][0]).toMatchObject({ themeId: 18, originTaskId: 1519 });
  });

  it('still fails on a finding that names a criterion', async () => {
    replyFindings = [
      { severity: 'major', summary: 'taskkill に別の PID が渡る', criterion: '1', evidence: 'a:1' },
      RACE,
    ];
    const r = await reviewDiffAdversarially({ taskId: 1519, worktreePath: tmpdir() });
    expect(r.verdict).toBe('fail');
    expect(r.reasons.some((x) => x.includes('taskkill'))).toBe(true);
    expect(r.reasons.some((x) => x.includes('複数の dev-all'))).toBe(false);
  });
});
