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
  test.each([
    { human: true, resumeImplementer: true },
    { human: true },
    { human: false, resumeImplementer: true },
  ])('具体的なパスを持たない旧範囲指定は質問待ちを維持する (%j)', (opts) => {
    const selected = pick({ planImpact: 'none', requiresPlanScopeRevision: true });
    expect(decideAnswerRouting(selected, opts)).toEqual({
      route: 'reject',
      reason: 'file_approval_required',
    });
  });
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
      ...pick({ requiresPlanScopeRevision: true }),
      ...pick({ planImpact: 'criteria' }),
    ];
    expect(decideAnswerRouting(sel, { human: true }).reason).toBe('criteria_change');
    expect(decideAnswerRouting([], { human: true }).route).toBe('resume');
  });
  test('明示的な方針変更は運用者の再開指定や許可提案より優先する', () => {
    const selected = [
      ...pick({ planImpact: 'approach' }),
      ...pick({ requiresPlanScopeRevision: true, label: '先頭' }),
      ...pick({ requiresPlanScopeRevision: true, label: '後続' }),
    ];
    expect(decideAnswerRouting(selected, { human: true, resumeImplementer: true })).toEqual({
      route: 'revision',
      reason: 'approach_change',
      trigger: selected[0],
    });
  });

  test('パスを伴う旧許可は署名の検証へ進み、別の旧改訂選択は再開指定を要する', () => {
    const grant = pick({ planRevision: true, grantsFiles: ['src/extra.ts'] });
    const mixed = [...grant, ...pick({ planRevision: true })];
    expect(decideAnswerRouting(grant, { human: true })).toMatchObject({
      route: 'grant',
      reason: 'out_of_plan_files_approved',
    });
    expect(decideAnswerRouting(mixed, { human: true })).toMatchObject({
      route: 'revision',
      reason: 'legacy_plan_revision',
      requiresFileApproval: true,
    });
    expect(decideAnswerRouting(mixed, { human: true, resumeImplementer: true }).route).toBe(
      'grant',
    );
    expect(decideAnswerRouting(grant, { human: false }).route).toBe('reject');
  });

  test('旧改訂のゲート変更は上書き不可で、許可提案との併用は質問待ちを維持する', () => {
    const gateChange = pick({ planRevision: true, mutatesGate: true });
    const opts = { human: true, resumeImplementer: true };
    expect(decideAnswerRouting(gateChange, opts).route).toBe('revision');
    expect(
      decideAnswerRouting(pick({ mutatesGate: true, grantsFiles: ['src/extra.ts'] }), opts).route,
    ).toBe('reject');
  });
});

describe('ファイル許可がある質問での選択キーの照合', () => {
  const prompt =
    '```json:options\n' +
    JSON.stringify({
      questions: [
        {
          id: 'Q1',
          summary: '許可',
          options: [
            { key: 'A', label: '追加する', grantsFiles: ['src/extra.ts'] },
            { key: 'B', label: '計画内で続ける' },
          ],
        },
        { id: 'Q2', summary: '補足', freeTextRequired: true },
      ],
    }) +
    '\n```';
  const pickGrant = { questionId: 'Q1', selectedKey: 'A' };

  test.each([
    [[], true],
    [[pickGrant, pickGrant], true],
    [[{ ...pickGrant, selectedKey: null }], true],
    [[{ ...pickGrant, selectedKey: 'B' }], false],
    [[pickGrant, { questionId: 'Q2', selectedKey: null }], false],
  ] as const)('選択の組合せ %j の無効判定は %s', (selections, invalid) => {
    expect(matchQuestionSelections(prompt, [...selections])).toMatchObject({
      hasGrantQuestion: true,
      invalid,
    });
  });
});
