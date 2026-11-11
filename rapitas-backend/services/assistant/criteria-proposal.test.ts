/**
 * criteria-proposal tests (companion design 段B, stage 1 item 1)
 */
import { describe, expect, test } from 'bun:test';
import {
  normalizeCriteria,
  ensureProposedCriteria,
  criteriaFromDescription,
  proposeCriteria,
  classifyVerifier,
  findVagueTerm,
  withoutCriteriaSection,
  reviewCriteria,
  splitByVerifier,
  descriptionForJury,
  detectTaskKind,
  MAX_CRITERIA,
  MIN_PROPOSED_CRITERIA,
  MAX_PROPOSED_CRITERIA,
} from './criteria-proposal';
import { checkSpecQuality } from '../intake/spec-quality-checker';

describe('normalizeCriteria', () => {
  test('trims, drops blanks, non-strings and duplicates, keeps order', () => {
    expect(normalizeCriteria([' a ', '', 'b', 3, 'a', null])).toEqual(['a', 'b']);
  });
  test('bounds the count and is empty for a non-array', () => {
    expect(normalizeCriteria(Array.from({ length: 20 }, (_, i) => `c${i}`))).toHaveLength(
      MAX_CRITERIA,
    );
    expect(normalizeCriteria('a')).toEqual([]);
  });
});

describe('ensureProposedCriteria', () => {
  test('keeps a real proposal first, supplemented to three', () => {
    const out = ensureProposedCriteria(['x'], 't');
    expect(out.fallback).toBe(false);
    expect(out.criteria[0]).toBe('x');
    expect(out.criteria).toHaveLength(MIN_PROPOSED_CRITERIA);
  });
  test('falls back to three distinct criteria for the task, not one generic line', () => {
    const out = ensureProposedCriteria([], '歯医者を予約');
    expect(out.fallback).toBe(true);
    expect(out.criteria).toHaveLength(3);
    expect(out.criteria[0]).toContain('「歯医者を予約」');
    expect(new Set(out.criteria).size).toBe(3);
  });
});

describe('proposeCriteria (段B)', () => {
  test('3〜7: three or more proposed are kept as they are, more than seven cut', () => {
    const three = ['a が表示される', 'b が保存される', 'c が送信される'];
    expect(proposeCriteria({ title: 't', proposed: three }).criteria).toEqual(three);
    expect(proposeCriteria({ title: 't', proposed: three }).supplemented).toBe(0);
    const nine = Array.from({ length: 9 }, (_, i) => `項目${i}が一覧に出る`);
    expect(proposeCriteria({ title: 't', proposed: nine }).criteria).toHaveLength(
      MAX_PROPOSED_CRITERIA,
    );
  });

  test('supplements come from the goals and constraints before the generic sentences', () => {
    const out = proposeCriteria({
      title: '請求書の発行',
      proposed: [],
      goals: JSON.stringify(['月末に請求書を送れる']),
      constraints: ['既存の顧客データを変えない'],
    });
    expect(out.criteria[0]).toContain('月末に請求書を送れる');
    expect(out.criteria[1]).toContain('既存の顧客データを変えない');
    expect(out.items.every((i) => i.supplemented)).toBe(true);
  });

  test('each item carries a verifier mark and, when vague, a rewording hint', () => {
    const out = proposeCriteria({
      title: 't',
      proposed: ['画面が使いやすい', 'API が 200 を返す', '本人が見て納得できる'],
    });
    expect(out.items.map((i) => i.verifier)).toEqual(['jury', 'jury', 'user']);
    expect(out.items[0].vague).toEqual({
      term: '使いやすい',
      suggestion: expect.stringContaining('タップ'),
    });
    expect(out.items[1].vague).toBeUndefined();
  });

  test('the score is spec-quality-checker’s for the spec carrying these criteria', () => {
    const input = { title: 't', proposed: ['a が出る'], description: 'x'.repeat(60), goals: ['g'] };
    const out = proposeCriteria(input);
    const expected = checkSpecQuality({
      description: input.description,
      goals: input.goals,
      constraints: null,
      acceptanceCriteria: out.criteria,
    });
    expect(out.quality.score).toBe(expected.score);
    expect(out.quality.isAdequate).toBe(expected.isAdequate);
  });

  test('vague items are counted and named in the reasons', () => {
    const out = proposeCriteria({
      title: 't',
      proposed: ['速く動く', 'きちんと動く', 'ログが出る'],
    });
    expect(out.quality.vagueCount).toBe(2);
    expect(out.quality.reasons.some((r) => r.includes('速く動く'))).toBe(true);
  });
});

describe('classifyVerifier / findVagueTerm', () => {
  test('judgement calls only the person can make are marked user', () => {
    expect(classifyVerifier('ユーザーが自分で試して満足できる')).toBe('user');
    expect(classifyVerifier('ビルドが通る')).toBe('jury');
  });
  test('plain checkable sentences have no vague term', () => {
    expect(findVagueTerm('3タップ以内で登録できる')).toBeNull();
    expect(findVagueTerm('表示が改善される')?.term).toBe('改善する');
  });
});

describe('criteriaFromDescription', () => {
  test('reads the checklist under ## 完了条件 only', () => {
    const d = 'やる\n\n## 完了条件\n- [ ] 一つ目\n- [x] 二つ目\n- 三つ目\n\n## メモ\n- これは違う';
    expect(criteriaFromDescription(d)).toEqual(['一つ目', '二つ目', '三つ目']);
  });
  test('nothing without the heading', () => {
    expect(criteriaFromDescription('## 受入基準\n- a')).toEqual([]);
    expect(criteriaFromDescription(undefined)).toEqual([]);
  });
});

describe('withoutCriteriaSection', () => {
  test('removes only that section', () => {
    expect(withoutCriteriaSection('やる\n\n## 完了条件\n- [ ] a\n\n## メモ\n- b')).toBe(
      'やる\n\n## メモ\n- b',
    );
    expect(withoutCriteriaSection('やる')).toBe('やる');
  });
});

/** Software-only wording that must never reach a life task. */
const SOFTWARE_WORDING = /既存の機能|テスト|変更内容|変更したファイル|差分|コマンド/;

describe('supplements fit the kind of task (fix2 item 3)', () => {
  test('歯医者を予約: no software sentence, and the booking evidence is named', () => {
    const out = proposeCriteria({ title: '歯医者を予約', proposed: [] });
    expect(out.kind).toBe('errand');
    for (const c of out.criteria) expect(c).not.toMatch(SOFTWARE_WORDING);
    // What settles a booking, and the record that proves it.
    expect(out.criteria.some((c) => c.includes('日時') && c.includes('場所'))).toBe(true);
    expect(out.criteria.some((c) => /予約番号/.test(c) && /確認メール/.test(c))).toBe(true);
    // No diff exists for a booking, so nothing is offered to the jury.
    expect(out.items.every((i) => i.verifier === 'user')).toBe(true);
    expect(out.items.some((i) => i.generic)).toBe(false);
  });

  test('a reader-proposed criterion on an errand is the person’s too', () => {
    const out = proposeCriteria({ title: '歯医者を予約', proposed: ['予約が取れている'] });
    expect(out.items[0]).toMatchObject({ text: '予約が取れている', verifier: 'user' });
  });

  test('other errands get their own evidence: payment, application, purchase, contact', () => {
    const cases: Array<[string, RegExp]> = [
      ['自動車税を支払う', /領収書|明細|振込の控え/],
      ['パスポートの申請', /受付番号|控え/],
      ['プリンターのインクを買う', /注文番号|レシート/],
      ['大家さんに電話で連絡', /通話の記録|メッセージ/],
    ];
    for (const [title, evidence] of cases) {
      const out = proposeCriteria({ title, proposed: [] });
      expect(out.kind).toBe('errand');
      expect(out.criteria.some((c) => evidence.test(c))).toBe(true);
      for (const c of out.criteria) expect(c).not.toMatch(SOFTWARE_WORDING);
    }
  });

  test('software tasks keep the jury sentences, including "nothing unrelated broke"', () => {
    const out = proposeCriteria({ title: 'ログイン画面のバグを修正', proposed: [] });
    expect(out.kind).toBe('software');
    expect(out.criteria.some((c) => c.includes('既存の機能'))).toBe(true);
    expect(out.items.filter((i) => i.verifier === 'jury').length).toBeGreaterThanOrEqual(2);
  });

  test('"予約機能を実装" is software, not an errand', () => {
    expect(detectTaskKind({ title: '予約機能を実装' })).toBe('software');
  });

  test('too little to go on: generic sentences are the person’s, flagged, never the jury’s', () => {
    const out = proposeCriteria({ title: 'あれ', proposed: [] });
    expect(out.kind).toBe('unknown');
    expect(out.items).toHaveLength(3);
    expect(out.items.every((i) => i.verifier === 'user' && i.generic)).toBe(true);
    for (const c of out.criteria) expect(c).not.toMatch(SOFTWARE_WORDING);
    expect(out.quality.reasons.some((r) => r.includes('仮の文'))).toBe(true);
  });
});

describe('reviewCriteria / splitByVerifier (fix2 items 2 and 5)', () => {
  test('an edited criterion is re-classified and re-scored, with nothing added', () => {
    const before = reviewCriteria({ title: 't', proposed: ['API が 200 を返す'] });
    const after = reviewCriteria({ title: 't', proposed: ['本人が見て納得できる'] });
    expect(before.items.map((i) => i.verifier)).toEqual(['jury']);
    expect(after.items.map((i) => i.verifier)).toEqual(['user']);
    expect(after.items).toHaveLength(1);
    const expected = checkSpecQuality({
      description: null,
      goals: null,
      constraints: null,
      acceptanceCriteria: ['本人が見て納得できる'],
    });
    expect(after.quality.score).toBe(expected.score);
  });

  test('a generic sentence stays flagged until it is reworded', () => {
    const proposal = proposeCriteria({ title: 'あれ', proposed: [] });
    const kept = reviewCriteria({ title: 'あれ', proposed: proposal.criteria });
    expect(kept.items.every((i) => i.generic)).toBe(true);
    const edited = reviewCriteria({ title: 'あれ', proposed: ['書類が机の上に3部ある'] });
    expect(edited.items[0].generic).toBeUndefined();
  });

  test('splits by the verifier the card showed, order kept', () => {
    const proposal = proposeCriteria({ title: 'ログイン画面のバグを修正', proposed: [] });
    const split = splitByVerifier({
      title: 'ログイン画面のバグを修正',
      proposed: proposal.criteria,
    });
    const jury = proposal.items.filter((i) => i.verifier === 'jury').map((i) => i.text);
    const user = proposal.items.filter((i) => i.verifier === 'user').map((i) => i.text);
    expect(split).toEqual({ acceptanceCriteria: jury, userAcceptanceChecks: user });
    expect(user.length).toBeGreaterThan(0);
  });

  test('an errand: everything goes to userAcceptanceChecks, none to the jury', () => {
    const proposal = proposeCriteria({ title: '歯医者を予約', proposed: [] });
    const split = splitByVerifier({ title: '歯医者を予約', proposed: proposal.criteria });
    expect(split.acceptanceCriteria).toEqual([]);
    expect(split.userAcceptanceChecks).toEqual(proposal.criteria);
  });
});

describe('the task’s own text decides the kind, not its checklist (fix3 item 2)', () => {
  const LISTED = ['予約確認の画面を保存する', '日時が決まる', '場所が決まる'];
  const withSection = `電話で予約する\n\n## 完了条件\n${LISTED.map((c) => `- [ ] ${c}`).join('\n')}`;

  test('the description with or without its checklist gives the same tags', () => {
    const a = reviewCriteria({ title: '歯医者を予約', description: withSection, proposed: LISTED });
    const b = reviewCriteria({
      title: '歯医者を予約',
      description: '電話で予約する',
      proposed: LISTED,
    });
    expect(a.kind).toBe('errand');
    expect(a.items).toEqual(b.items);
    expect(a.items.every((i) => i.verifier === 'user')).toBe(true);
  });

  test('propose, review and split agree on the same input', () => {
    const input = { title: '歯医者を予約', description: withSection, proposed: LISTED };
    const proposed = proposeCriteria(input).items.map((i) => i.verifier);
    const reviewed = reviewCriteria(input).items.map((i) => i.verifier);
    const split = splitByVerifier(input);
    expect(proposed).toEqual(reviewed);
    expect(split.userAcceptanceChecks).toEqual(LISTED);
    expect(split.acceptanceCriteria).toEqual([]);
  });
});

describe('descriptionForJury', () => {
  const split = { acceptanceCriteria: ['J'], userAcceptanceChecks: ['U'] };

  test('always: re-composes the checklist from the jury’s criteria, raw text checked', () => {
    expect(
      descriptionForJury('本文\n\n## 完了条件\n- [ ] U\n- [ ] J', split, { section: 'always' }),
    ).toBe('本文\n\n## 完了条件\n- [ ] J');
    expect(descriptionForJury('本文', split, { section: 'always' })).toBe(
      '本文\n\n## 完了条件\n- [ ] J',
    );
  });

  test('no jury criteria: no heading at all', () => {
    expect(
      descriptionForJury(
        '本文\n\n## 完了条件\n- [ ] U',
        { acceptanceCriteria: [], userAcceptanceChecks: ['U'] },
        { section: 'always' },
      ),
    ).toBe('本文');
  });

  test('ifPresent: untouched text stays byte for byte', () => {
    expect(descriptionForJury('  本文\n- 別の話 ', split, { section: 'ifPresent' })).toBe(
      '  本文\n- 別の話 ',
    );
  });

  test('a list line repeating a person’s check is dropped under any heading', () => {
    expect(
      descriptionForJury('本文\n\n## 受入基準\n- J\n- [ ] U', split, { section: 'ifPresent' }),
    ).toBe('本文\n\n## 受入基準\n- J');
  });
});
