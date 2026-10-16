/**
 * review-prompt.test
 *
 * The review round exists so requirement gaps are found before implementation
 * instead of by a bounced task. Measured 2026-10-11: TempoRaid's 12 tasks took
 * 6 verify_repair rounds, several on behaviour its specification never pinned.
 *
 * The parser's contract is that a bad reply degrades to "no questions" — the
 * mechanical findings are still worth showing, and blocking the wizard on a
 * parse failure would be a worse outcome than a thinner review.
 */

import { describe, expect, it } from 'vitest';
import {
  formatReviewAnswers,
  parseReviewQuestions,
  shouldReviewAgain,
  MAX_REVIEW_ROUNDS,
} from '../review-prompt';

const wrap = (questions: unknown) => JSON.stringify({ questions });

describe('parseReviewQuestions', () => {
  it('reads well-formed questions', () => {
    const out = parseReviewQuestions(
      wrap([
        {
          id: 'scale',
          question: '同時接続はどの規模ですか',
          impact: 'Redis常設の要否が変わります',
          options: ['〜10人', '〜100人', '〜1万人'],
        },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: 'scale',
      question: '同時接続はどの規模ですか',
      impact: 'Redis常設の要否が変わります',
      options: ['〜10人', '〜100人', '〜1万人'],
    });
  });

  it('tolerates a fenced code block', () => {
    const out = parseReviewQuestions('```json\n' + wrap([{ id: 'a', question: 'q' }]) + '\n```');
    expect(out.map((q) => q.id)).toEqual(['a']);
  });

  it('recovers the object when the model wraps it in prose', () => {
    const out = parseReviewQuestions(
      `確認事項をまとめました。\n${wrap([{ id: 'a', question: 'q' }])}\n以上です。`,
    );
    expect(out.map((q) => q.id)).toEqual(['a']);
  });

  it('degrades to no questions instead of throwing', () => {
    for (const bad of ['', 'not json at all', '{', '{"questions": "nope"}', '[]']) {
      expect(() => parseReviewQuestions(bad)).not.toThrow();
      expect(parseReviewQuestions(bad)).toEqual([]);
    }
  });

  it('drops entries that cannot be answered or would collide', () => {
    const out = parseReviewQuestions(
      wrap([
        { id: 'a', question: '1件目' },
        { id: '', question: 'IDなし' },
        { id: 'b', question: '   ' },
        { id: 'a', question: 'ID重複' },
      ]),
    );
    expect(out.map((q) => q.id)).toEqual(['a']);
    expect(out[0]?.question).toBe('1件目');
  });

  it('caps the list so the step stays answerable', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, question: `質問${i}` }));
    expect(parseReviewQuestions(wrap(many))).toHaveLength(8);
  });

  it('keeps at most four options and discards non-strings', () => {
    const out = parseReviewQuestions(
      wrap([{ id: 'a', question: 'q', options: ['1', 2, '', '3', '4', '5', '6'] }]),
    );
    expect(out[0]?.options).toEqual(['1', '3', '4', '5']);
  });

  it('defaults a missing impact to empty rather than dropping the question', () => {
    const out = parseReviewQuestions(wrap([{ id: 'a', question: 'q' }]));
    expect(out[0]?.impact).toBe('');
    expect(out[0]?.options).toEqual([]);
  });
});

describe('formatReviewAnswers', () => {
  const questions = [
    { id: 'scale', question: '同時接続はどの規模ですか', impact: '', options: [] },
    { id: 'budget', question: '予算はいくらですか', impact: '', options: [] },
  ];

  it('pairs each answered question with its answer', () => {
    expect(formatReviewAnswers(questions, { scale: '〜100人', budget: '月1万円' })).toBe(
      '- 同時接続はどの規模ですか → 〜100人\n- 予算はいくらですか → 月1万円',
    );
  });

  it('omits unanswered questions so silence is not reported as a decision', () => {
    expect(formatReviewAnswers(questions, { scale: '〜100人' })).toBe(
      '- 同時接続はどの規模ですか → 〜100人',
    );
    expect(formatReviewAnswers(questions, { scale: '   ' })).toBe('');
    expect(formatReviewAnswers(questions, {})).toBe('');
  });
});

describe('shouldReviewAgain — 壁打ちの終了条件 (2026-10-12)', () => {
  // 報告: 「実装前に確認しておきたい事を回答しても何回回答しても次のフェーズに
  // 行かないでループしている」。原因は再生成のたびに無条件でレビューへ戻り、
  // 保存済みの回答を消して新しい質問を出していたこと。モデルの質問は助言であり
  // (ブロックする判定は機械検査が持つ)、ウィザードを開いたままにする力を持たせない。
  it('機械検査が通っていれば、質問が残っていても結果へ進む', () => {
    expect(shouldReviewAgain({ round: 0, implementable: true })).toBe(false);
    expect(shouldReviewAgain({ round: 1, implementable: true })).toBe(false);
  });

  it('error が残っている間は再度レビューを見せる', () => {
    expect(shouldReviewAgain({ round: 0, implementable: false })).toBe(true);
    expect(shouldReviewAgain({ round: 1, implementable: false })).toBe(true);
  });

  it('上限に達したら、error が残っていても結果へ進む（永久ループを作らない）', () => {
    expect(shouldReviewAgain({ round: MAX_REVIEW_ROUNDS, implementable: false })).toBe(false);
    expect(shouldReviewAgain({ round: MAX_REVIEW_ROUNDS + 1, implementable: false })).toBe(false);
  });

  it('上限は有限（設定ミスで無限にならないこと）', () => {
    expect(MAX_REVIEW_ROUNDS).toBeGreaterThan(0);
    expect(MAX_REVIEW_ROUNDS).toBeLessThanOrEqual(3);
  });
});
