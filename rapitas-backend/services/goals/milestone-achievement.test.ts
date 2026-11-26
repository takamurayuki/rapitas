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
  reachRateWithDue,
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

describe('reachRateWithDue', () => {
  const now = new Date('2026-11-26T00:00:00Z');
  const day = (n: number) => new Date(now.getTime() + n * 86_400_000);
  type Row = { status: string; dueDate: Date | null; reachedAt: Date | null };
  const m = (status: string, dueDate: Date | null, reachedAt: Date | null = null): Row => ({
    status,
    dueDate,
    reachedAt,
  });

  // Each row: [name, milestones, numerator, denominator, rate]
  const table: Array<[string, Row[], number, number, number | null]> = [
    ['reached + overdue open', [m('reached', day(-5), day(-6)), m('open', day(-1))], 1, 2, 0.5],
    [
      'paused is out of the denominator even when overdue',
      [m('reached', null, day(-1)), m('paused', day(-9))],
      1,
      1,
      1,
    ],
    [
      'open before its due date is not counted',
      [m('reached', day(-3), day(-4)), m('open', day(3))],
      1,
      1,
      1,
    ],
    ['open without a due date is not counted', [m('open', null)], 0, 0, null],
    [
      'reached without a due date counts as reached',
      [m('reached', null, day(-2)), m('open', null)],
      1,
      1,
      1,
    ],
    ['nothing at all gives null, not 0', [], 0, 0, null],
    ['only paused gives null', [m('paused', day(-3))], 0, 0, null],
    ['overdue and never reached gives 0 of 1', [m('open', day(-1))], 0, 1, 0],
  ];

  test.each(table)('%s', (_name, milestones, numerator, denominator, rate) => {
    expect(reachRateWithDue(milestones, now)).toEqual({ numerator, denominator, rate });
  });

  test('a period start keeps only milestones reached or due since then', () => {
    const milestones = [
      m('reached', null, day(-40)),
      m('reached', null, day(-3)),
      m('open', day(-50)),
      m('open', day(-2)),
    ];
    expect(reachRateWithDue(milestones, now, day(-28))).toEqual({
      numerator: 1,
      denominator: 2,
      rate: 0.5,
    });
  });

  test.each([
    ['到達が期間開始と一致', m('reached', null, day(-28)), 1, 1],
    ['到達が期間開始の1ms前', m('reached', null, new Date(day(-28).getTime() - 1)), 0, 0],
    ['期日が期間開始と一致', m('open', day(-28)), 0, 1],
    ['期日が期間開始の1ms前', m('open', new Date(day(-28).getTime() - 1)), 0, 0],
    ['期日が現在と一致', m('open', now), 0, 0],
    ['期日が現在の1ms前', m('open', new Date(now.getTime() - 1)), 0, 1],
  ] as const)('%s', (_name, row, numerator, denominator) => {
    expect(reachRateWithDue([row], now, day(-28))).toEqual({
      numerator,
      denominator,
      rate: denominator === 0 ? null : numerator / denominator,
    });
  });
});
