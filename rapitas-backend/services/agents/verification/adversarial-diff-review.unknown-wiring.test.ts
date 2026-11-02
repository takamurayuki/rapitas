/**
 * adversarial-diff-review.unknown-wiring.test
 *
 * The S1 pre-registered claim: every `unknown` the production path records
 * carries a reason, so `unknownBreakdown` never reports `unattributed`.
 *
 * juror-unknown-reason.test.ts proves the taxonomy CAN label. It cannot prove
 * the review wires each cause to it — that is the part that was missing when
 * the panel slid from three voters to one and the ledger could not say why.
 * So this drives the real `reviewDiffAdversarially`, forces each cause, and
 * reads the payload that actually reaches the timeline.
 *
 * Why a harness and not one deliberate timeout against the running server: a
 * live timeout exercises one of the four causes, writes a synthetic verdict
 * into the judge-calibration ledger, and leaves nothing behind that would
 * catch the next unlabelled path.
 */
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { unknownBreakdown, type RecordedJuror } from './juror-unknown-reason';

/** What each provider does when asked. Set per test. */
type Behaviour = 'hang' | 'throw' | 'garbage' | 'pass';
let behaviour: Record<string, Behaviour> = {};

const sendAIMessage = mock((args: { provider: string }) => {
  switch (behaviour[args.provider] ?? 'pass') {
    // Never settles, so the deadline wins the race.
    case 'hang':
      return new Promise<{ content: string }>(() => {});
    case 'throw':
      return Promise.reject(new Error('no credentials'));
    case 'garbage':
      return Promise.resolve({ content: 'I would rather not say.' });
    default:
      return Promise.resolve({
        content: JSON.stringify({ verdict: 'pass', severity: 0, reasons: [] }),
      });
  }
});

interface ReviewEvent {
  eventType: string;
  payload: {
    jurors: { provider: string; verdict: string; unknownReason?: string }[];
    panel: { planned: number; asked: number; judged: number; rested: string[] };
  };
}
const events: ReviewEvent[] = [];

mock.module('../orchestrator/git-operations/core/diff-structured', () => ({
  getDiff: mock(() =>
    Promise.resolve([
      { filename: 'src/other.ts', status: 'M', additions: 1, deletions: 0, patch: '+x' },
    ]),
  ),
  resolveBaseRef: mock(() => Promise.resolve('HEAD')),
}));
// 'api' seats one juror per provider family, which is what lets a single
// review carry three different causes at once.
mock.module('../../../utils/ai-client', () => ({ sendAIMessage, getAuxAiMode: () => 'api' }));
mock.module('../../workflow/workflow-file-utils', () => ({
  resolveWorkflowDir: mock(() => Promise.resolve({ dir: '/wf/1' })),
  readWorkflowFile: mock(() => Promise.resolve('plan content')),
}));
mock.module('../../memory/timeline', () => ({
  appendEvent: mock((e: ReviewEvent) => {
    events.push(e);
    return Promise.resolve({ id: events.length });
  }),
}));
// Not under test here, and the real one wants a git repo on disk.
mock.module('./base-satisfied-plan-items', () => ({
  applyBaseSatisfiedFilter: mock((r: unknown) => Promise.resolve(r)),
}));
mock.module('../../../config/database', () => ({
  prisma: {
    agentExecution: { findFirst: mock(() => Promise.resolve(null)) },
    agentExecutionConfig: { findUnique: mock(() => Promise.resolve(null)) },
    task: { findUnique: mock(() => Promise.resolve({ title: 'Task', acceptanceCriteria: null })) },
  },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { reviewDiffAdversarially, resetJurorHealth } = await import('./adversarial-diff-review');

const originalTimeout = process.env.RAPITAS_ADVERSARIAL_JUROR_TIMEOUT_MS;
const originalEnabled = process.env.RAPITAS_ADVERSARIAL_REVIEW;

beforeEach(() => {
  resetJurorHealth();
  events.length = 0;
  behaviour = {};
  // The hanging juror has to lose the race quickly or the suite waits 120s.
  process.env.RAPITAS_ADVERSARIAL_JUROR_TIMEOUT_MS = '25';
  delete process.env.RAPITAS_ADVERSARIAL_REVIEW;
});

afterAll(() => {
  if (originalTimeout === undefined) delete process.env.RAPITAS_ADVERSARIAL_JUROR_TIMEOUT_MS;
  else process.env.RAPITAS_ADVERSARIAL_JUROR_TIMEOUT_MS = originalTimeout;
  if (originalEnabled === undefined) delete process.env.RAPITAS_ADVERSARIAL_REVIEW;
  else process.env.RAPITAS_ADVERSARIAL_REVIEW = originalEnabled;
});

/** The juror rows of the one review this call recorded. */
async function recordedJurors(): Promise<ReviewEvent['payload']['jurors']> {
  await reviewDiffAdversarially({ taskId: 9001, worktreePath: '/wt/9001' });
  const review = events.find((e) => e.eventType === 'adversarial_review');
  expect(review).toBeDefined();
  return review?.payload.jurors ?? [];
}

describe('each cause reaches the timeline with its own label', () => {
  it.each([
    ['ran past its deadline', 'timeout', 'hang'],
    ['threw from the provider call', 'error', 'throw'],
    ['answered something unreadable', 'unparsable', 'garbage'],
  ] as const)('labels a juror that %s as %s', async (_what, reason, how) => {
    behaviour = { gemini: how };
    const jurors = await recordedJurors();
    const gemini = jurors.find((j) => j.provider === 'gemini');
    expect(gemini?.verdict).toBe('unknown');
    expect(gemini?.unknownReason).toBe(reason);
  });

  it('labels the gate being switched off', async () => {
    process.env.RAPITAS_ADVERSARIAL_REVIEW = '0';
    const r = await reviewDiffAdversarially({ taskId: 9001, worktreePath: '/wt/9001' });
    expect(r.verdict).toBe('unknown');
    expect(r.unknownReason).toBe('disabled');
    // Nothing judged, so nothing belongs in the calibration ledger.
    expect(events).toHaveLength(0);
  });
});

describe('the pre-registered claim', () => {
  it('reports no unattributed unknown when every juror fails differently', async () => {
    behaviour = { claude: 'hang', gemini: 'throw', chatgpt: 'garbage' };
    const jurors = await recordedJurors();
    const rows: RecordedJuror[] = jurors.map((j) => ({
      label: j.provider,
      verdict: j.verdict,
      unknownReason: j.unknownReason as RecordedJuror['unknownReason'],
    }));
    const breakdown = unknownBreakdown(rows);

    // Keyed by reason alone, and the counts sum to the number of unknowns —
    // so an unlabelled path cannot hide inside a neighbour's bucket.
    expect(breakdown.unattributed).toBeUndefined();
    expect(breakdown).toEqual({ timeout: 1, error: 1, unparsable: 1 });

    // Which provider failed which way, since the slide this exists to catch
    // was one provider's unknowns climbing while the others held.
    expect(rows.find((r) => r.label === 'claude')?.unknownReason).toBe('timeout');
    expect(rows.find((r) => r.label === 'gemini')?.unknownReason).toBe('error');
    expect(rows.find((r) => r.label === 'chatgpt')?.unknownReason).toBe('unparsable');
  });

  it('records a full panel that judged nothing, rather than a small panel', async () => {
    behaviour = { claude: 'hang', gemini: 'hang', chatgpt: 'hang' };
    await reviewDiffAdversarially({ taskId: 9001, worktreePath: '/wt/9001' });
    const panel = events.find((e) => e.eventType === 'adversarial_review')?.payload.panel;
    expect(panel?.planned).toBe(3);
    expect(panel?.asked).toBe(3);
    expect(panel?.judged).toBe(0);
  });
});
