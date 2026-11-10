/**
 * adversarial-diff-review.seating.test
 *
 * The review's seats as assigned from the tier table and the vendors usable
 * right now, through the real review entry point: the executor's tier raises
 * the reviewer floor, a vendor in cooldown is re-planned around, and a seat
 * no usable model can fill is left unmet and recorded — never filled by a
 * lower tier. Infrastructure is mocked at the module boundary before import
 * (config/database connects on import if not mocked first).
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

const getDiff = mock(() =>
  Promise.resolve([{ filename: 'a.ts', status: 'M', additions: 1, deletions: 0, patch: '+line' }]),
);
const sendAIMessage = mock((_o: unknown) =>
  Promise.resolve({ content: '{"verdict":"pass","severity":0,"reasons":[]}' }),
);
mock.module('../orchestrator/git-operations/core/diff-structured', () => ({ getDiff }));
let auxMode: 'api' | 'cli' = 'cli';
mock.module('../../../utils/ai-client', () => ({ sendAIMessage, getAuxAiMode: () => auxMode }));
/** What this host is configured for (configured-vendors.ts), per test. */
let apiKeys: Array<'anthropic' | 'openai' | 'google'> = ['anthropic', 'google', 'openai'];
mock.module('../../ai/model-tier-table/configured-vendors', () => ({
  resolveConfiguredVendors: async (mode: string) =>
    mode === 'cli'
      ? { configured: ['anthropic'], unconfigured: [] }
      : {
          configured: apiKeys,
          unconfigured: (['anthropic', 'google', 'openai'] as const)
            .filter((v) => !apiKeys.includes(v))
            .map((vendor) => ({ vendor, reason: 'API キーが設定されていない' })),
        },
}));
mock.module('../../workflow/workflow-file-utils', () => ({
  resolveWorkflowDir: mock(() => Promise.resolve({ dir: '/wf/1' })),
  readWorkflowFile: mock(() => Promise.resolve('plan content')),
}));

/**
 * The implementer's pinned route, as model-route-stability writes it — the
 * PLAN, which the seats must not trust over what actually ran.
 */
let implementerPin: string | null = null;
/** Models the implementer's runs reported (AgentExecution.modelName), newest first. */
let implementerRuns: string[] = [];
const appendEventMock = mock((_e: unknown) => Promise.resolve({ id: 1 }));
mock.module('../../memory/timeline', () => ({
  appendEvent: appendEventMock,
  queryEvents: mock(async (o: { eventType?: string; correlationId?: string }) => {
    if (
      o.eventType === 'model_route_pin' &&
      o.correlationId === 'route_1_implementer' &&
      implementerPin
    ) {
      return {
        events: [{ payload: { decision: { recommendedModel: implementerPin } } }],
        total: 1,
      };
    }
    return { events: [] as unknown[], total: 0 };
  }),
}));
mock.module('./review-cost-record', () => ({ recordReviewCost: mock(async () => 0) }));
const decisions: Array<Record<string, unknown>> = [];
mock.module('../../observability/decision-trace', () => ({
  recordDecision: (input: Record<string, unknown>) => {
    decisions.push(input);
    return Promise.resolve();
  },
}));
mock.module('../../../config/database', () => ({
  prisma: {
    agentExecution: {
      findFirst: mock(() => Promise.resolve(null)),
      findMany: mock(async () => implementerRuns.map((modelName) => ({ modelName }))),
    },
    agentExecutionConfig: { findUnique: mock(() => Promise.resolve(null)) },
    task: { findUnique: mock(() => Promise.resolve({ title: 'Task', acceptanceCriteria: null })) },
  },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { reviewDiffAdversarially, resetJurorHealth } = await import('./adversarial-diff-review');
const { __resetCooldowns, markProviderCooldown } = await import('../../ai/provider-cooldown');

type Asked = { provider: string; model: string };
const asked = () =>
  (sendAIMessage.mock.calls as unknown as Array<[Asked]>).map((c) => ({
    provider: c[0].provider,
    model: c[0].model,
  }));
type ReviewEvent = {
  payload: {
    seating?: {
      mode: string;
      executorModel: string | null;
      seats: Array<{ seatId: string; model: string; requiredTier: string; independence: string }>;
      executorVerified: boolean;
      shortfalls: Array<{
        seatId: string;
        requiredTier: string;
        reason: string;
        override?: string;
      }>;
      unavailable: Array<{ vendor: string; reason: string }>;
    };
    jurors: Array<{ seatId?: string; unknownReason?: string }>;
  };
};
const lastReviewEvent = () =>
  (appendEventMock.mock.calls as unknown as Array<[ReviewEvent & { eventType: string }]>)
    .map((c) => c[0])
    .filter((e) => e.eventType === 'adversarial_review')
    .at(-1)!;

beforeEach(() => {
  sendAIMessage.mockClear();
  appendEventMock.mockClear();
  decisions.length = 0;
  implementerPin = null;
  implementerRuns = [];
  apiKeys = ['anthropic', 'google', 'openai'];
  auxMode = 'cli';
  resetJurorHealth();
  __resetCooldowns();
  delete process.env.RAPITAS_JURY_MODELS;
});
afterEach(() => {
  __resetCooldowns();
  delete process.env.RAPITAS_JURY_MODELS;
});

describe('陪審の席の組み替え（ティア表 × 使えるベンダー）', () => {
  it('Claude だけ: 実行役が premium なら両レビュー席を premium にし、記録に残す', async () => {
    implementerRuns = ['claude-opus-5-5'];
    const result = await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(result.verdict).toBe('pass');
    expect(asked().map((a) => a.model)).toEqual(['claude-opus-5-5', 'claude-opus-5-5']);
    const seating = lastReviewEvent().payload.seating!;
    expect(seating.mode).toBe('single_vendor');
    expect(seating.executorModel).toBe('claude-opus-5-5');
    expect(seating.seats.find((s) => s.seatId === 'reviewer-2')!.requiredTier).toBe('premium');
    expect(seating.seats.every((s) => s.independence === 'context_isolation')).toBe(true);
    expect(seating.shortfalls).toEqual([]);
  });

  it('両ベンダー（API）: レビュー席1は実行役と別系統で問い合わせる', async () => {
    auxMode = 'api';
    implementerRuns = ['claude-sonnet-5-5'];
    await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    const first = asked()[0];
    expect(first.provider).not.toBe('claude');
    expect(lastReviewEvent().payload.seating!.mode).toBe('cross_vendor');
    expect(
      lastReviewEvent().payload.seating!.seats.find((s) => s.seatId === 'reviewer-1')!.independence,
    ).toBe('cross_vendor');
  });

  it('API で OpenAI がクォータ枯渇: 残ったベンダーで制約を保って組み直し、止まらない', async () => {
    auxMode = 'api';
    implementerRuns = ['claude-sonnet-5-5'];
    markProviderCooldown('openai', 'quota');
    const result = await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(result.verdict).toBe('pass');
    expect(asked().some((a) => a.provider === 'chatgpt')).toBe(false);
    const seating = lastReviewEvent().payload.seating!;
    expect(seating.unavailable).toEqual([{ vendor: 'openai', reason: 'quota' }]);
    expect(seating.shortfalls).toEqual([]);
    expect(seating.seats.find((s) => s.seatId === 'reviewer-1')!.model).not.toMatch(/^gpt-/);
  });

  it('Claude CLI が使えない（Codex だけ）: 席を下げずに未充足とし、表示と記録を残す', async () => {
    implementerRuns = ['gpt-6.1-sol'];
    markProviderCooldown('claude', 'auth');
    const result = await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(sendAIMessage).not.toHaveBeenCalled();
    // An unfillable jury is "unavailable", never a pass and never a fail that
    // would bounce the implementer for something it did not do.
    expect(result.verdict).not.toBe('pass');
    expect(result.verdict).not.toBe('fail');
    const event = lastReviewEvent();
    expect(event.payload.seating!.shortfalls.map((s) => s.seatId)).toEqual([
      'reviewer-1',
      'reviewer-2',
      'verifier',
    ]);
    expect(event.payload.jurors.map((j) => j.unknownReason)).toEqual(['seat_unmet', 'seat_unmet']);
    expect(decisions.some((d) => d.summary === '陪審の席の要件未達')).toBe(true);
  });

  it('実行役は pin ではなく実行記録から求める: 明示指定の Opus で実装 → レビュー席2も premium', async () => {
    // An explicitly configured model never goes through the router, so there
    // is no pin at all; the run record still says Opus.
    implementerPin = null;
    implementerRuns = ['claude-opus-5-5'];
    await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(asked().map((a) => a.model)).toEqual(['claude-opus-5-5', 'claude-opus-5-5']);
    const seating = lastReviewEvent().payload.seating!;
    expect(seating.executorModel).toBe('claude-opus-5-5');
    expect(seating.executorVerified).toBe(true);
  });

  it('pin と実行記録が食い違えば実行記録を採る（pin は Sonnet、実際は Opus）', async () => {
    implementerPin = 'claude-sonnet-5-5';
    implementerRuns = ['claude-opus-5-5'];
    await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(lastReviewEvent().payload.seating!.executorModel).toBe('claude-opus-5-5');
    expect(asked().every((a) => a.model === 'claude-opus-5-5')).toBe(true);
  });

  it('実行記録がなければ実行役は未確認とし、premium とみなして下限を決める', async () => {
    implementerPin = 'claude-sonnet-5-5';
    implementerRuns = [];
    await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    const seating = lastReviewEvent().payload.seating!;
    expect(seating.executorVerified).toBe(false);
    expect(seating.executorModel).toBeNull();
    expect(seating.seats.every((s) => s.requiredTier === 'premium')).toBe(true);
  });

  it('API キーのないベンダーには問い合わせない（Anthropic だけ設定済み）', async () => {
    auxMode = 'api';
    apiKeys = ['anthropic'];
    implementerRuns = ['claude-sonnet-5-5'];
    await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(asked().every((a) => a.provider === 'claude')).toBe(true);
    const seating = lastReviewEvent().payload.seating!;
    expect(seating.unavailable.map((u) => u.vendor).sort()).toEqual(['google', 'openai']);
  });

  it('RAPITAS_JURY_MODELS=haiku,haiku,haiku でも実行役 Opus なら Haiku に問い合わせず、記録は実際と一致する', async () => {
    process.env.RAPITAS_JURY_MODELS = 'haiku,haiku,haiku';
    implementerRuns = ['claude-opus-5-5'];
    const result = await reviewDiffAdversarially({ taskId: 1, worktreePath: '/wt' });
    expect(sendAIMessage).not.toHaveBeenCalled();
    expect(result.verdict).not.toBe('pass');
    const seating = lastReviewEvent().payload.seating!;
    expect(seating.seats).toEqual([]);
    expect(seating.shortfalls.map((s) => s.override)).toEqual(['haiku', 'haiku', 'haiku']);
    expect(decisions.some((d) => d.summary === '陪審の席の要件未達')).toBe(true);
  });
});
