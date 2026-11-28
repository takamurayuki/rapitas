/**
 * miss-summary — the judgment feed for task 1586 and the daily numbers (task 1602)
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fakeClock, resetFakeTimeline, seedEvent, seedJob } from './timeline-fake.fixture';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }),
}));

const { listJudgmentMisses, summarizeSelfVerifyMisses } = await import('./miss-summary');

const since = new Date('2026-11-27T00:00:00Z');
const until = new Date('2026-11-28T00:00:00Z');
const inWindow = (h: number) => new Date(since.getTime() + h * 3600_000);

function miss(taskId: number, runId: string, gate: string, kind: string, at: Date, extra = {}) {
  seedEvent(
    'self_verify_miss',
    `self-verify-miss-${taskId}`,
    {
      taskId,
      runId,
      revision: `sha-${runId}`,
      gate,
      gateFamily: gate.split(':')[0],
      checkName: gate.includes(':') ? gate.slice(gate.indexOf(':') + 1) : null,
      kind,
      reasonSummary: `reason ${gate}`,
      files: ['rapitas-backend/a.ts'],
      dedupKey: `${runId}|${gate}`,
      ...extra,
    },
    at,
  );
}

beforeEach(() => {
  resetFakeTimeline();
  fakeClock.now = inWindow(1);
});

describe('listJudgmentMisses (input contract of task 1586)', () => {
  test('returns judgment misses only, newest first, in the lesson shape', async () => {
    miss(1, 'r1', 'verify', 'judgment', inWindow(2));
    miss(2, 'r2', 'ci:Lint Code', 'mechanical', inWindow(3));
    miss(3, 'r3', 'diff_review', 'judgment', inWindow(4));
    const lessons = await listJudgmentMisses({ since, until });
    expect(lessons.map((l) => l.gate)).toEqual(['diff_review', 'verify']);
    expect(lessons[0]).toEqual({
      taskId: 3,
      runId: 'r3',
      revision: 'sha-r3',
      gate: 'diff_review',
      reasonSummary: 'reason diff_review',
      files: ['rapitas-backend/a.ts'],
      createdAt: inWindow(4).toISOString(),
    });
  });

  test('a duplicate written by a race is returned once', async () => {
    miss(1, 'r1', 'verify', 'judgment', inWindow(2));
    miss(1, 'r1', 'verify', 'judgment', inWindow(3));
    expect(await listJudgmentMisses({ since, until })).toHaveLength(1);
  });

  test('nothing recorded is an empty list', async () => {
    expect(await listJudgmentMisses()).toEqual([]);
  });
});

describe('summarizeSelfVerifyMisses', () => {
  test('counts and rates by kind and gate over passing runs in the window', async () => {
    seedJob(1, 'r1', { at: inWindow(1) });
    seedJob(2, 'r2', { at: inWindow(2) });
    seedJob(3, 'r3', { at: inWindow(3) });
    seedJob(4, 'r4', { at: inWindow(4) });
    seedJob(5, 'r-red', { at: inWindow(5), ok: false });
    miss(1, 'r1', 'ci:Lint Code', 'mechanical', inWindow(6));
    miss(1, 'r1', 'verify', 'judgment', inWindow(6));
    miss(2, 'r2', 'verify', 'judgment', inWindow(7));
    miss(2, 'r2', 'verify', 'judgment', inWindow(8)); // duplicate
    const s = await summarizeSelfVerifyMisses({ since, until });
    expect(s.passedRuns).toBe(4);
    expect(s.misses).toBe(3);
    expect(s.missedRuns).toBe(2);
    expect(s.rate).toBe(0.5);
    const kind = Object.fromEntries(s.byKind.map((k) => [k.key, k]));
    expect(kind.mechanical).toMatchObject({ misses: 1, missedRuns: 1, rate: 0.25 });
    expect(kind.judgment).toMatchObject({ misses: 2, missedRuns: 2, rate: 0.5 });
    const gate = Object.fromEntries(s.byGate.map((g) => [g.key, g]));
    expect(gate['ci:Lint Code']).toMatchObject({ kind: 'mechanical', misses: 1, rate: 0.25 });
    expect(gate.verify).toMatchObject({ kind: 'judgment', misses: 2, rate: 0.5 });
  });

  test('a mechanical miss whose check is not fully in the catalog is a candidate', async () => {
    seedJob(1, 'r1', { at: inWindow(1) });
    miss(1, 'r1', 'ci:Lint Code', 'mechanical', inWindow(2));
    miss(1, 'r1', 'ci:Knip (frontend)', 'mechanical', inWindow(2));
    miss(1, 'r1', 'presave:secret', 'mechanical', inWindow(2));
    miss(1, 'r1', 'presave:verifier', 'mechanical', inWindow(2));
    const { candidates } = await summarizeSelfVerifyMisses({ since, until });
    const byGate = Object.fromEntries(candidates.map((c) => [c.gate, c]));
    expect(byGate['ci:Lint Code']!.status).toBe('partial');
    expect(byGate['ci:Lint Code']!.uncoveredSteps).toContain('Unused files');
    expect(byGate['ci:Knip (frontend)']!.status).toBe('missing');
    expect(byGate['presave:verifier']!.status).toBe('missing');
    expect(byGate['presave:secret']).toBeUndefined();
  });

  test('no passing run gives no rate instead of dividing by zero', async () => {
    const s = await summarizeSelfVerifyMisses({ since, until });
    expect(s).toMatchObject({ passedRuns: 0, misses: 0, rate: null, candidates: [] });
    expect(s.byKind.every((k) => k.rate === null)).toBe(true);
  });

  test('more passing runs than one page are all counted', async () => {
    for (let i = 0; i < 620; i++) seedJob(i, `p${i}`, { at: new Date(inWindow(1).getTime() + i) });
    expect((await summarizeSelfVerifyMisses({ since, until })).passedRuns).toBe(620);
  });
});
