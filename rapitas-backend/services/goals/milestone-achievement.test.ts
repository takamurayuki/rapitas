/**
 * milestone-achievement.test
 *
 * A milestone counts as reached only when the person has confirmed every
 * agreed criterion and written down why — never inferred from task counts.
 */
import { describe, expect, test } from 'bun:test';
import {
  checkConfirmation,
  goalProgress,
  parseMilestoneCriteria,
  MILESTONE_STATUSES,
} from './milestone-achievement';

describe('parseMilestoneCriteria', () => {
  test('reads the stored JSON array, trimming and dropping blanks and duplicates', () => {
    expect(
      parseMilestoneCriteria(JSON.stringify([' 模試で7割 ', '', '模試で7割', '過去問3年分'])),
    ).toEqual(['模試で7割', '過去問3年分']);
  });

  test.each([null, undefined, '', 'not json', '{"a":1}', '42'])(
    'treats %p as no criteria',
    (raw) => {
      expect(parseMilestoneCriteria(raw)).toEqual([]);
    },
  );
});

describe('checkConfirmation', () => {
  const criteria = ['模試で7割', '過去問3年分'];

  test('accepts when every criterion is checked and the evidence is written', () => {
    expect(
      checkConfirmation({
        status: 'open',
        criteria,
        checkedCriteria: ['過去問3年分', '模試で7割'],
        evidence: '11/10 の模試で 74%',
      }),
    ).toEqual({ ok: true, evidence: '11/10 の模試で 74%' });
  });

  test('refuses a milestone with no agreed criteria (nothing to confirm against)', () => {
    expect(
      checkConfirmation({ status: 'open', criteria: [], checkedCriteria: [], evidence: 'done' }),
    ).toEqual({ ok: false, code: 'milestone_criteria_required' });
  });

  test('refuses while any criterion is left unchecked', () => {
    expect(
      checkConfirmation({
        status: 'open',
        criteria,
        checkedCriteria: ['模試で7割'],
        evidence: 'まだ途中',
      }),
    ).toEqual({ ok: false, code: 'milestone_criteria_unchecked' });
  });

  test('refuses a check against criteria that changed since the dialog opened', () => {
    expect(
      checkConfirmation({
        status: 'open',
        criteria,
        checkedCriteria: ['模試で7割', '過去問2年分'],
        evidence: 'x',
      }),
    ).toEqual({ ok: false, code: 'milestone_criteria_changed' });
  });

  test.each(['', '   '])('refuses blank evidence %p', (evidence) => {
    expect(
      checkConfirmation({ status: 'open', criteria, checkedCriteria: criteria, evidence }),
    ).toEqual({ ok: false, code: 'milestone_evidence_required' });
  });

  test('refuses confirming a milestone that is already reached', () => {
    expect(
      checkConfirmation({ status: 'reached', criteria, checkedCriteria: criteria, evidence: 'x' }),
    ).toEqual({ ok: false, code: 'milestone_already_reached' });
  });
});

describe('goalProgress', () => {
  test('counts reached over the milestones still being pursued (paused ones are excluded)', () => {
    expect(
      goalProgress([
        { status: 'reached' },
        { status: 'open' },
        { status: 'paused' },
        { status: 'reached' },
      ]),
    ).toEqual({ total: 4, reached: 2, paused: 1, open: 1, reachRate: 2 / 3 });
  });

  test('has no rate when nothing is being pursued', () => {
    expect(goalProgress([])).toEqual({ total: 0, reached: 0, paused: 0, open: 0, reachRate: null });
    expect(goalProgress([{ status: 'paused' }]).reachRate).toBeNull();
  });

  test('treats an unknown stored status as open, so it is never silently counted as reached', () => {
    expect(goalProgress([{ status: 'done' }]).open).toBe(1);
    expect(MILESTONE_STATUSES).toEqual(['open', 'reached', 'paused']);
  });
});
