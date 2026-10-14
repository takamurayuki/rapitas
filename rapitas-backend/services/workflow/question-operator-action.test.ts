/**
 * question-operator-action.test
 *
 * 実測（2026-10-14、#1215 の question.md 6 版と WorkflowTransition 全行）:
 *
 *   file_saved:question  1791840151484  → question_resolved reason=auto_recommended (15分後)
 *   file_saved:question  1791843815564  → question_resolved（人間の回答、唯一）
 *   file_saved:question  1791875390978
 *   plan_question_budget_exhausted      {"count":3,"limit":3}  → blocked
 *
 * 予算を使い切った 3 周のうち、推奨選択肢が運用者作業だったものが含まれる
 * （「#1214 を develop にマージした後、この plan のまま実装を再開する」と
 * 「運用者がプロジェクトルートで @vitest/coverage-v8@2.1.4 を core に追加し…」）。
 * 4 周目は「運用者作業が終わるまで保留にし、実装フェーズを自動で再開しない」
 * という正当なエスカレーションで、それが予算切れで弾かれて blocked になった。
 *
 * つまり「エージェントが質問を繰り返している」回数と「人の作業を待っている」
 * 回数が同じ予算を共有していた。ここはその2つを分ける判定だけを持つ。
 */
import { describe, test, expect } from 'bun:test';
import {
  OPERATOR_WAIT_METADATA_KEY,
  questionWaitsOnOperator,
  roundWaitsOnOperator,
  transitionWaitedOnOperator,
} from './question-operator-action';
import type { ParsedQuestion } from './question-options-parser';

const question = (over: Partial<ParsedQuestion> = {}): ParsedQuestion => ({
  id: 'Q1',
  summary: 's',
  options: [],
  freeTextRequired: false,
  freeTextReason: null,
  recommended: '',
  recommendedReason: '',
  ...over,
});

const option = (key: string, operator: boolean) => ({
  key,
  label: key,
  consequence: '',
  mutatesGate: false,
  planRevision: false,
  requiresOperatorAction: operator,
});

describe('questionWaitsOnOperator', () => {
  test('推奨選択肢が運用者作業なら、人の作業待ち', () => {
    const q = question({ options: [option('A', true), option('B', false)], recommended: 'A' });
    expect(questionWaitsOnOperator(q)).toBe(true);
  });

  test('全選択肢が運用者作業なら、推奨が無くても人の作業待ち', () => {
    const q = question({ options: [option('A', true), option('B', true)] });
    expect(questionWaitsOnOperator(q)).toBe(true);
  });

  // 逃げ道がある質問は、エージェント自身が進められる。これを人の作業待ちと
  // 数えると、質問の繰り返しが無制限になる（予算の意味が消える）。
  test('運用者作業でない推奨があるなら、人の作業待ちではない', () => {
    const q = question({ options: [option('A', true), option('B', false)], recommended: 'B' });
    expect(questionWaitsOnOperator(q)).toBe(false);
  });

  test('運用者作業の選択肢が無ければ、人の作業待ちではない', () => {
    const q = question({ options: [option('A', false)], recommended: 'A' });
    expect(questionWaitsOnOperator(q)).toBe(false);
  });

  test('選択肢が無い（自由入力のみ）質問は、人の作業待ちと断定しない', () => {
    expect(questionWaitsOnOperator(question({ freeTextRequired: true }))).toBe(false);
  });
});

describe('roundWaitsOnOperator', () => {
  test('1 問でも人の作業待ちなら、その周は人の作業待ち', () => {
    const block = {
      questions: [
        question({ options: [option('A', false)], recommended: 'A' }),
        question({ id: 'Q2', options: [option('A', true)], recommended: 'A' }),
      ],
    };
    expect(roundWaitsOnOperator(block)).toBe(true);
  });

  test('どの問もエージェントが進められるなら false', () => {
    const block = { questions: [question({ options: [option('A', false)], recommended: 'A' })] };
    expect(roundWaitsOnOperator(block)).toBe(false);
  });

  // パース不能な question.md を人の作業待ちに寄せると、既存の予算が無効化される。
  test('null（パース不能）は人の作業待ちにしない', () => {
    expect(roundWaitsOnOperator(null)).toBe(false);
  });
});

describe('transitionWaitedOnOperator', () => {
  test('metadata のフラグを読む', () => {
    expect(transitionWaitedOnOperator({ [OPERATOR_WAIT_METADATA_KEY]: true })).toBe(true);
    expect(transitionWaitedOnOperator({ [OPERATOR_WAIT_METADATA_KEY]: false })).toBe(false);
  });

  // フラグ導入前の行には何も入っていない。それを人の作業待ちと読むと、過去の
  // 周回が全部予算から消えて上限が実質無効になる。
  test('フラグが無い過去の行は、エージェントの質問として数える', () => {
    expect(transitionWaitedOnOperator({ sizeBytes: 1894, previousStatus: 'plan_approved' })).toBe(
      false,
    );
    expect(transitionWaitedOnOperator(null)).toBe(false);
    expect(transitionWaitedOnOperator(undefined)).toBe(false);
    expect(transitionWaitedOnOperator('{"a":1}')).toBe(false);
  });

  test('JSON 文字列で保存されていても読める', () => {
    expect(transitionWaitedOnOperator(`{"${OPERATOR_WAIT_METADATA_KEY}":true}`)).toBe(true);
  });
});
