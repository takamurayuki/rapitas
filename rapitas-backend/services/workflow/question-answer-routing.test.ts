/**
 * question-answer-routing.test
 *
 * Routing table of task 1546: which answers revise the plan and which resume
 * the implementer with the plan untouched.
 */
import { describe, expect, test } from 'bun:test';
import { decideAnswerRouting, matchQuestionSelections } from './question-answer-routing';
import type { ParsedQuestionOption } from './question-options-parser';

const q = {
  id: 'Q1',
  summary: 's',
  options: [],
  freeTextRequired: false,
  recommended: '',
  recommendedReason: '',
};
const pick = (o: Partial<ParsedQuestionOption>) => [
  { question: q, option: { key: 'A', label: 'a', ...o } },
];

describe('decideAnswerRouting', () => {
  test('planImpact none wins over planRevision flag', () => {
    expect(
      decideAnswerRouting(pick({ planRevision: true, planImpact: 'none' }), { human: true }).route,
    ).toBe('resume');
  });
  test('legacy planRevision alone still revises', () => {
    const d = decideAnswerRouting(pick({ planRevision: true }), { human: true });
    expect(d.route).toBe('revision');
    expect(d.reason).toBe('legacy_plan_revision');
  });
  test('criteria revises', () => {
    expect(decideAnswerRouting(pick({ planImpact: 'criteria' }), { human: true }).reason).toBe(
      'criteria_change',
    );
  });
  test('人の再開指定は旧改訂フラグに適用される', () => {
    const d = decideAnswerRouting(pick({ planRevision: true }), {
      human: true,
      resumeImplementer: true,
    });
    expect(d).toEqual({ route: 'resume', reason: 'operator_resume_implementer' });
  });
  test('再開指定は完了条件の変更を上書きできない', () => {
    const d = decideAnswerRouting(pick({ planImpact: 'criteria' }), {
      human: true,
      resumeImplementer: true,
    });
    expect(d.route).toBe('revision');
    expect(d.reason).toBe('criteria_not_overridable');
  });
  test('自動回答では再開指定が無効になる', () => {
    const d = decideAnswerRouting(pick({ planRevision: true }), {
      human: false,
      resumeImplementer: true,
    });
    expect(d.route).toBe('revision');
  });
  test('criteria wins among several selections; no selection resumes', () => {
    const sel = [
      ...pick({ planRevision: true }),
      ...pick({ planImpact: 'none' }),
      ...pick({ planImpact: 'approach' }),
      ...pick({ planImpact: 'criteria', label: '先頭' }),
      ...pick({ planImpact: 'criteria', label: '後続' }),
    ];
    expect(decideAnswerRouting(sel, { human: true, resumeImplementer: true })).toEqual({
      route: 'revision',
      reason: 'criteria_not_overridable',
      trigger: sel[3],
    });
    expect(decideAnswerRouting([], { human: true })).toEqual({
      route: 'resume',
      reason: 'no_plan_change',
    });
  });
  test('明示的な方針変更は運用者の再開指定と実装詳細より優先する', () => {
    const selected = [
      ...pick({ planImpact: 'none', planRevision: true }),
      ...pick({ planImpact: 'approach', label: '先頭' }),
      ...pick({ planImpact: 'approach', label: '後続' }),
    ];
    expect(decideAnswerRouting(selected, { human: true, resumeImplementer: true })).toEqual({
      route: 'revision',
      reason: 'approach_change',
      trigger: selected[1],
    });
  });

  test('旧改訂のゲート変更は上書きできない', () => {
    const selected = [
      ...pick({ planRevision: true }),
      ...pick({ planRevision: true, mutatesGate: true }),
    ];
    expect(decideAnswerRouting(selected, { human: true, resumeImplementer: true })).toEqual({
      route: 'revision',
      reason: 'legacy_plan_revision',
      trigger: selected[1],
    });
  });
});

describe('質問IDと選択キーの照合', () => {
  const prompt =
    '```json:options\n' +
    JSON.stringify({
      questions: [
        {
          id: 'Q1',
          summary: '実装の細部',
          options: [
            { key: 'A', label: '既存フィクスチャ', planImpact: 'none' },
            { key: 'B', label: '旧形式の改訂', planImpact: 'bogus', planRevision: true },
          ],
        },
        { id: 'Q2', summary: '運用の補足', freeTextRequired: true },
      ],
    }) +
    '\n```';
  test('一致した全ての選択肢を照合順に判定し、未知の分類では旧フラグを使う', () => {
    const selected = matchQuestionSelections(prompt, [
      { questionId: 'Q1', selectedKey: 'A' },
      { questionId: 'Q2', selectedKey: null },
      { questionId: 'Q3', selectedKey: 'A' },
      { questionId: 'Q1', selectedKey: 'Z' },
      { questionId: 'Q1', selectedKey: 'B' },
    ]);
    expect(selected.map(({ option }) => option.key)).toEqual(['A', 'B']);
    expect(decideAnswerRouting(selected, { human: true })).toEqual({
      route: 'revision',
      reason: 'legacy_plan_revision',
      trigger: selected[1],
    });
  });
});
