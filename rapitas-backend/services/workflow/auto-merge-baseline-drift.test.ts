/**
 * auto-merge-baseline-drift test
 *
 * Pins drift detection on the integration branch and its notification throttle
 * (task 1021).
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  checkBaselineDrift,
  resetBaselineDriftState,
  type DriftDeps,
} from './auto-merge-baseline-drift';
import type { RatchetVerdict } from './auto-merge-premerge-gate';

const HOUR = 60 * 60 * 1000;

function makeDeps(verdict: RatchetVerdict, clock: { t: number }) {
  const messages: string[] = [];
  const deps: DriftDeps = {
    now: () => clock.t,
    runRatchet: async () => verdict,
    notifyDrift: async (m) => {
      messages.push(m);
    },
  };
  return { deps, messages };
}

describe('checkBaselineDrift', () => {
  beforeEach(() => resetBaselineDriftState());

  it('notifies when the branch violates the baseline', async () => {
    const clock = { t: 1_000_000 };
    const { deps, messages } = makeDeps(
      { verdict: 'violation', detail: 'x.ts: 654 > baseline 628' },
      clock,
    );
    expect(await checkBaselineDrift({ repoRoot: '/r', branch: 'develop', deps })).toBe(true);
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain('x.ts: 654 > baseline 628');
  });

  it('notifies at most once per 24h while the drift persists', async () => {
    const clock = { t: 1_000_000 };
    const { deps, messages } = makeDeps({ verdict: 'violation', detail: 'd' }, clock);
    await checkBaselineDrift({ repoRoot: '/r', deps });
    clock.t += HOUR; // past the check interval, inside the notify window
    await checkBaselineDrift({ repoRoot: '/r', deps });
    expect(messages.length).toBe(1);
    clock.t += 24 * HOUR;
    await checkBaselineDrift({ repoRoot: '/r', deps });
    expect(messages.length).toBe(2);
  });

  it('does not re-run the ratchet inside the check interval', async () => {
    const clock = { t: 1_000_000 };
    let runs = 0;
    const deps: DriftDeps = {
      now: () => clock.t,
      runRatchet: async () => {
        runs++;
        return { verdict: 'pass' };
      },
      notifyDrift: async () => {},
    };
    await checkBaselineDrift({ repoRoot: '/r', deps });
    await checkBaselineDrift({ repoRoot: '/r', deps });
    expect(runs).toBe(1);
  });

  it('stays silent when clean, skipped or errored', async () => {
    for (const verdict of [
      { verdict: 'pass' },
      { verdict: 'skipped' },
      { verdict: 'error', detail: 'e' },
    ] as RatchetVerdict[]) {
      resetBaselineDriftState();
      const { deps, messages } = makeDeps(verdict, { t: 5 });
      expect(await checkBaselineDrift({ repoRoot: '/r', deps })).toBe(false);
      expect(messages).toEqual([]);
    }
  });
});
