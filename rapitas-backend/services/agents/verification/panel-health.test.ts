/**
 * panel-health unit tests
 *
 * How many models actually judged, over time. The gate collapsed from three
 * voters to one across September 2026 and nothing showed it, because the
 * verdict kept arriving and nobody was counting the voters.
 *
 * What these tests mostly pin down is what this must NOT do. The first
 * design for this stage enforced a minimum juror count inside the verdict,
 * and that would have made the gate weaker, not stronger: with one juror
 * saying fail, discarding the verdict as "not enough voters" lets the change
 * through on the low-risk fail-open path. So the threshold only labels; it
 * never touches a verdict.
 */
import { describe, test, expect } from 'bun:test';
import { DEFAULT_MIN_JUDGED, summarisePanelHealth, type PanelHealthRow } from './panel-health';

const review = (judged: number, at: string, planned = 3): PanelHealthRow => ({
  judged,
  planned,
  at: new Date(at),
});

describe('average judged voters over time', () => {
  test('separates the collapsed month from the recovered one', () => {
    // The pre-registered claim: a 2.0 threshold tells September from October.
    const h = summarisePanelHealth(
      [
        review(1, '2026-09-10T00:00:00Z'),
        review(1, '2026-09-11T00:00:00Z'),
        review(3, '2026-10-24T00:00:00Z'),
        review(3, '2026-10-24T01:00:00Z'),
      ],
      DEFAULT_MIN_JUDGED,
    );
    const sep = h.byDay.find((d) => d.date === '2026-09-10');
    const oct = h.byDay.find((d) => d.date === '2026-10-24');
    expect(sep?.averageJudged).toBe(1);
    expect(oct?.averageJudged).toBe(3);
    expect(sep?.underStrength).toBe(1);
    expect(oct?.underStrength).toBe(0);
  });

  test('groups several reviews in one day', () => {
    const h = summarisePanelHealth(
      [review(1, '2026-10-01T01:00:00Z'), review(3, '2026-10-01T02:00:00Z')],
      DEFAULT_MIN_JUDGED,
    );
    expect(h.byDay).toHaveLength(1);
    expect(h.byDay[0]?.reviews).toBe(2);
    expect(h.byDay[0]?.averageJudged).toBe(2);
  });

  test('days come back in order', () => {
    const h = summarisePanelHealth(
      [review(3, '2026-10-03T00:00:00Z'), review(1, '2026-10-01T00:00:00Z')],
      DEFAULT_MIN_JUDGED,
    );
    expect(h.byDay.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-03']);
  });
});

describe('under-strength counting', () => {
  test('counts a review below the threshold', () => {
    const h = summarisePanelHealth([review(1, '2026-10-01T00:00:00Z')], 2);
    expect(h.underStrength).toBe(1);
    expect(h.underStrengthShare).toBeCloseTo(1, 6);
  });

  test('a panel exactly at the threshold is not under strength', () => {
    const h = summarisePanelHealth([review(2, '2026-10-01T00:00:00Z')], 2);
    expect(h.underStrength).toBe(0);
  });

  test('counts seats that were never asked, separately', () => {
    // A rested juror leaves the panel before anyone is asked, so a review can
    // be at full judged strength and still have lost a seat.
    const h = summarisePanelHealth([review(2, '2026-10-01T00:00:00Z', 3)], 2);
    expect(h.underStrength).toBe(0);
    expect(h.seatsLost).toBe(1);
  });

  test('reports shares as null on no reviews', () => {
    // 0% would read as a measured zero.
    const h = summarisePanelHealth([], 2);
    expect(h.reviews).toBe(0);
    expect(h.averageJudged).toBeNull();
    expect(h.underStrengthShare).toBeNull();
  });
});

describe('what it refuses to do', () => {
  test('exposes no verdict of any kind', () => {
    // The threshold labels; it never decides. A field that looked like a
    // verdict would invite a caller to act on it, which is the design that
    // would have weakened the gate.
    const h = summarisePanelHealth([review(1, '2026-10-01T00:00:00Z')], 2);
    expect(h).not.toHaveProperty('verdict');
    expect(h).not.toHaveProperty('shouldBlock');
    expect(h).not.toHaveProperty('reviewIncomplete');
  });

  test('the default threshold is two', () => {
    // One voter cannot form a majority with anything; two is the smallest
    // panel where the skeptical tie rule has something to break.
    expect(DEFAULT_MIN_JUDGED).toBe(2);
  });
});
