/**
 * juror-unknown-reason unit tests
 *
 * `unknown` means "this juror did not judge", and four different things
 * produce it: the call threw, it ran past the deadline, it answered with
 * something unparseable, or the gate was off. The record keeps none of that
 * — one value for four causes — so the September 2026 slide from 32 to 230
 * unknowns could not be attributed to any of them afterwards.
 *
 * A fifth case is worse than unlabelled: a juror rested after repeated
 * timeouts is dropped from the panel entirely, so it leaves no row at all.
 * The review then looks like a smaller jury that answered in full. These
 * tests hold down both halves — why a juror did not judge, and how many
 * seats the panel was supposed to have.
 */
import { describe, test, expect } from 'bun:test';
import {
  summarisePanel,
  unknownBreakdown,
  type PanelSeat,
  type RecordedJuror,
} from './juror-unknown-reason';

const juror = (label: string, verdict: string, unknownReason?: string): RecordedJuror =>
  ({ label, verdict, unknownReason }) as RecordedJuror;

const seat = (label: string): PanelSeat => ({ label }) as PanelSeat;

describe('how many seats actually answered', () => {
  test('records the seats that were dropped before anyone was asked', () => {
    // A rested juror never reaches the jurors array, so without this the
    // panel silently shrinks and the record cannot show it.
    const s = summarisePanel({
      planned: [seat('claude:opus'), seat('claude:sonnet'), seat('claude:haiku')],
      asked: [seat('claude:opus'), seat('claude:sonnet')],
      jurors: [juror('claude:opus', 'pass'), juror('claude:sonnet', 'fail')],
    });
    expect(s.planned).toBe(3);
    expect(s.asked).toBe(2);
    expect(s.rested).toEqual(['claude:haiku']);
  });

  test('counts the ones that answered, not the ones that were asked', () => {
    const s = summarisePanel({
      planned: [seat('a'), seat('b'), seat('c')],
      asked: [seat('a'), seat('b'), seat('c')],
      jurors: [
        juror('a', 'pass'),
        juror('b', 'unknown', 'timeout'),
        juror('c', 'unknown', 'error'),
      ],
    });
    expect(s.asked).toBe(3);
    expect(s.judged).toBe(1);
    expect(s.rested).toEqual([]);
  });

  test('a full panel that all answered has nothing to flag', () => {
    const s = summarisePanel({
      planned: [seat('a'), seat('b')],
      asked: [seat('a'), seat('b')],
      jurors: [juror('a', 'pass'), juror('b', 'fail')],
    });
    expect(s).toMatchObject({ planned: 2, asked: 2, judged: 2, rested: [] });
  });
});

describe('why a juror did not judge', () => {
  test('separates the four causes', () => {
    const b = unknownBreakdown([
      juror('a', 'unknown', 'timeout'),
      juror('b', 'unknown', 'error'),
      juror('c', 'unknown', 'unparsable'),
      juror('d', 'unknown', 'disabled'),
      juror('e', 'pass'),
    ]);
    expect(b).toEqual({ timeout: 1, error: 1, unparsable: 1, disabled: 1 });
  });

  test('counts an unknown with no reason as unattributed', () => {
    // The point of the exercise is that every unknown can be accounted for.
    // One that arrives unlabelled has to be visible, not folded into a
    // neighbouring cause — that is how the original outage stayed hidden.
    const b = unknownBreakdown([juror('a', 'unknown'), juror('b', 'unknown', 'timeout')]);
    expect(b).toEqual({ unattributed: 1, timeout: 1 });
  });

  test('ignores jurors that did judge', () => {
    expect(unknownBreakdown([juror('a', 'pass'), juror('b', 'fail')])).toEqual({});
  });

  test('adds up to the number of unknowns, always', () => {
    // The pre-registered claim for this stage: 100% of unknowns are
    // explained by the breakdown. That only holds if the counts reconcile.
    const jurors = [
      juror('a', 'unknown', 'timeout'),
      juror('b', 'unknown', 'timeout'),
      juror('c', 'unknown'),
      juror('d', 'pass'),
    ];
    const b = unknownBreakdown(jurors);
    const total = Object.values(b).reduce((s, n) => s + n, 0);
    expect(total).toBe(jurors.filter((j) => j.verdict === 'unknown').length);
  });
});
