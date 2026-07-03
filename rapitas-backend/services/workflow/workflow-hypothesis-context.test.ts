/**
 * workflow-hypothesis-context.test
 *
 * Unit tests for buildHypothesisContext() — the prompt-injection block builder.
 * Mocks '../memory/hypothesis-service' (mirroring ALL of its real exports, per
 * repo convention, since mock.module is process-global) and '../../config/database'.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

interface FakeHyp {
  id: number;
  domain: string;
  confidence: number;
  statement: string;
}

let openList: FakeHyp[] = [];
let supportedList: FakeHyp[] = [];
let refutedList: FakeHyp[] = [];
const statusCalls: Array<string | undefined> = [];
const themeIdCalls: Array<number | undefined> = [];
let listHypothesesShouldThrow = false;

const listHypotheses = mock((options: { status?: string; themeId?: number; limit?: number }) => {
  statusCalls.push(options.status);
  themeIdCalls.push(options.themeId);
  if (listHypothesesShouldThrow) return Promise.reject(new Error('db error'));
  const list =
    options.status === 'open'
      ? openList
      : options.status === 'supported'
        ? supportedList
        : refutedList;
  return Promise.resolve({ hypotheses: list, total: list.length });
});

mock.module('../memory/hypothesis-service', () => ({
  HYPOTHESIS_DOMAINS: ['codebase', 'agent-behavior', 'performance', 'architecture', 'other'],
  normalizeDomain: (v: unknown) => v ?? 'codebase',
  checkFalsifiable: () => null,
  isConcreteArtifact: () => true,
  submitHypothesis: () => Promise.resolve({ ok: true, id: 1 }),
  addEvidence: () => Promise.resolve({ ok: true }),
  listHypotheses,
  getHypothesis: () => Promise.resolve(null),
  setHypothesisStatus: () => Promise.resolve(true),
  deleteHypothesis: () => Promise.resolve(true),
  getHypothesisStats: () => Promise.resolve({ open: 0, supported: 0, refuted: 0, inconclusive: 0 }),
}));

const findUnique = mock(() => Promise.resolve<{ themeId: number | null } | null>({ themeId: 7 }));
mock.module('../../config/database', () => ({
  prisma: { task: { findUnique } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { buildHypothesisContext } = await import('./workflow-hypothesis-context');

beforeEach(() => {
  openList = [];
  supportedList = [];
  refutedList = [];
  statusCalls.length = 0;
  themeIdCalls.length = 0;
  listHypothesesShouldThrow = false;
  listHypotheses.mockClear();
  findUnique.mockReset();
  findUnique.mockResolvedValue({ themeId: 7 });
});

describe('buildHypothesisContext', () => {
  it('always includes the title and contribution guide, even with no hypotheses', async () => {
    const md = await buildHypothesisContext(1);

    expect(md).toContain('# 仮説台帳 (Hypothesis Ledger)');
    expect(md).toContain('## 仮説思考の指示');
    expect(md).not.toContain('## 検証待ちの仮説');
    expect(md).not.toContain('## 立証済み');
    expect(md).not.toContain('## 反証済み');
  });

  it('resolves themeId from the task row and forwards it to every listHypotheses call', async () => {
    await buildHypothesisContext(5);

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 5 }, select: { themeId: true } });
    expect(statusCalls).toEqual(['open', 'supported', 'refuted']);
    expect(themeIdCalls).toEqual([7, 7, 7]);
  });

  it('passes themeId undefined when the task row is not found', async () => {
    findUnique.mockResolvedValue(null);

    await buildHypothesisContext(5);

    expect(themeIdCalls).toEqual([undefined, undefined, undefined]);
  });

  it('passes themeId undefined when the task lookup itself rejects', async () => {
    findUnique.mockImplementation(() => Promise.reject(new Error('lookup failed')));

    const md = await buildHypothesisContext(5);

    expect(themeIdCalls).toEqual([undefined, undefined, undefined]);
    // The lookup failure is swallowed by .catch(() => null), not the outer try/catch.
    expect(md).toContain('# 仮説台帳 (Hypothesis Ledger)');
  });

  it('renders open hypotheses with id, domain, rounded confidence, and statement', async () => {
    openList = [{ id: 42, domain: 'codebase', confidence: 0.567, statement: 'X causes Y' }];

    const md = await buildHypothesisContext(1);

    expect(md).toContain('## 検証待ちの仮説');
    expect(md).toContain('- [#42] (codebase, 確信度57%) X causes Y');
  });

  it('rounds confidence to the nearest percent at both ends', async () => {
    openList = [
      { id: 1, domain: 'codebase', confidence: 0.004, statement: 'near zero' },
      { id: 2, domain: 'codebase', confidence: 0.995, statement: 'near one' },
    ];

    const md = await buildHypothesisContext(1);

    expect(md).toContain('確信度0%');
    expect(md).toContain('確信度100%');
  });

  it('renders supported hypotheses under the established-knowledge header', async () => {
    supportedList = [{ id: 9, domain: 'performance', confidence: 0.9, statement: 'proven claim' }];

    const md = await buildHypothesisContext(1);

    expect(md).toContain('## 立証済み（信頼してよい確定知見）');
    expect(md).toContain('- [#9] (performance, 確信度90%) proven claim');
  });

  it('renders refuted hypotheses under the do-not-pursue header', async () => {
    refutedList = [{ id: 3, domain: 'architecture', confidence: 0.1, statement: 'wrong claim' }];

    const md = await buildHypothesisContext(1);

    expect(md).toContain('## 反証済み（この前提に基づく案は避けよ）');
    expect(md).toContain('- [#3] (architecture, 確信度10%) wrong claim');
  });

  it('embeds the taskId into the evidence-recording API snippet (ja)', async () => {
    const md = await buildHypothesisContext(777);

    expect(md).toContain('taskId:777');
  });

  it('renders the English variant with English headers, guide, and taskId', async () => {
    openList = [{ id: 1, domain: 'codebase', confidence: 0.5, statement: 'stmt' }];

    const md = await buildHypothesisContext(321, 'en');

    expect(md).toContain('# Hypothesis Ledger');
    expect(md).toContain('## Open hypotheses');
    expect(md).toContain('## Hypothesis-thinking instructions');
    expect(md).toContain('taskId:321');
    expect(md).not.toContain('仮説台帳');
  });

  it('defaults to Japanese when no language is given', async () => {
    const md = await buildHypothesisContext(1);
    expect(md).toContain('# 仮説台帳 (Hypothesis Ledger)');
  });

  it('returns an empty string when the hypothesis lookups fail', async () => {
    listHypothesesShouldThrow = true;

    const md = await buildHypothesisContext(1);

    expect(md).toBe('');
  });
});
