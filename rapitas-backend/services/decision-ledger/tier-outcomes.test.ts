/**
 * tier-outcomes.test
 *
 * Covers reading "did the stronger tier buy anything for this role?" off the
 * ledger. The rule that matters: a decision the checker could not attribute —
 * a spend limit, a timeout, an upstream 5xx — counts for neither tier, because
 * it says nothing about the tier that was chosen.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const readDecisions = mock((): Promise<unknown[]> => Promise.resolve([]));
mock.module('./query', () => ({ readDecisions }));

const { tierOutcomesForRole } = await import('./tier-outcomes');

const d = (role: string, tier: string, verdict: string) => ({
  id: `trace:${Math.random()}`,
  at: new Date(),
  taskId: 1,
  kind: 'model_tier',
  subject: `${role} phase`,
  predicted: { adopted: 'm', tier, role },
  basis: '',
  outcome: null,
  verdict,
  costUsd: 0,
  source: 'decision_trace',
});

describe('tierOutcomesForRole', () => {
  beforeEach(() => readDecisions.mockReset().mockResolvedValue([]));

  test('counts settled decisions per tier for the requested role', async () => {
    readDecisions.mockResolvedValue([
      d('implementer', 'premium', 'correct'),
      d('implementer', 'premium', 'wrong'),
      d('implementer', 'standard', 'correct'),
    ]);

    const out = await tierOutcomesForRole('implementer');

    expect(out.find((o) => o.tier === 'premium')).toEqual({
      tier: 'premium',
      samples: 2,
      correct: 1,
      rate: 0.5,
    });
    expect(out.find((o) => o.tier === 'standard')?.rate).toBe(1);
  });

  test('an unattributable decision counts for neither tier', async () => {
    // Otherwise an outage reads as evidence against whichever tier was chosen.
    readDecisions.mockResolvedValue([
      d('implementer', 'premium', 'correct'),
      d('implementer', 'premium', 'indeterminate'),
      d('implementer', 'premium', 'pending'),
    ]);

    expect(await tierOutcomesForRole('implementer')).toEqual([
      { tier: 'premium', samples: 1, correct: 1, rate: 1 },
    ]);
  });

  test('ignores other roles', async () => {
    readDecisions.mockResolvedValue([
      d('verifier', 'premium', 'correct'),
      d('implementer', 'standard', 'correct'),
    ]);

    const out = await tierOutcomesForRole('implementer');
    expect(out.map((o) => o.tier)).toEqual(['standard']);
  });

  test('rows predating the role/tier recording are skipped, not miscounted', async () => {
    const legacy = { ...d('implementer', 'premium', 'correct'), predicted: { adopted: 'm' } };
    readDecisions.mockResolvedValue([legacy]);

    expect(await tierOutcomesForRole('implementer')).toEqual([]);
  });

  test('asks only for model_tier decisions within the window', async () => {
    await tierOutcomesForRole('implementer', 7);

    const arg = readDecisions.mock.calls[0]?.[0] as { kinds: string[]; since: Date };
    expect(arg.kinds).toEqual(['model_tier']);
    const days = (Date.now() - arg.since.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });
});
