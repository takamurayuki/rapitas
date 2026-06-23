/**
 * workflow-question-utils.test
 *
 * Unit tests for the pure Q&A parsing helpers (parseIntakeQuestions / splitIntakeQuestion).
 */
import { describe, it, expect } from 'vitest';
import { parseIntakeQuestions, splitIntakeQuestion } from './workflow-question-utils';

describe('parseIntakeQuestions', () => {
  it('parses multiple 質問N blocks with their 選択肢 (1問1答)', () => {
    const md = [
      '# 仕様確認',
      '',
      'タスクの仕様が不足しています。',
      '',
      '## 質問1: 達成すべきゴール',
      '何を最優先しますか？',
      '### 選択肢',
      '- 速度を優先する',
      '- 品質を優先する',
      '',
      '## 質問2: 完了条件',
      'どの基準で完了とみなしますか？',
      '### 選択肢',
      '- テストが通る',
      '- 計測で改善を確認',
      '',
      '## 回答方法',
      '選択肢から選んでください。',
    ].join('\n');

    const { intro, questions } = parseIntakeQuestions(md);

    expect(intro).toContain('仕様が不足');
    expect(questions).toHaveLength(2);
    expect(questions[0].label).toBe('質問1: 達成すべきゴール');
    expect(questions[0].text).toBe('何を最優先しますか？');
    expect(questions[0].options).toEqual(['速度を優先する', '品質を優先する']);
    expect(questions[1].label).toBe('質問2: 完了条件');
    expect(questions[1].options).toEqual(['テストが通る', '計測で改善を確認']);
  });

  it('stops the question list at a non-質問 heading (回答方法)', () => {
    const md = '## 質問1: x\nq\n### 選択肢\n- a\n## 回答方法\n選んで';
    const { questions } = parseIntakeQuestions(md);
    expect(questions).toHaveLength(1);
    expect(questions[0].options).toEqual(['a']);
  });

  it('returns no questions for a legacy single-question file (no 質問 blocks)', () => {
    const md = '# 仕様確認\n\nこれは質問です。\n## 選択肢\n- はい\n- いいえ';
    const { questions } = parseIntakeQuestions(md);
    expect(questions).toHaveLength(0);
  });

  it('parses a question with no 選択肢 as free-text (empty options)', () => {
    const md = '## 質問1: 自由記述\n詳細を教えてください\n## 回答方法\n記述';
    const { questions } = parseIntakeQuestions(md);
    expect(questions).toHaveLength(1);
    expect(questions[0].options).toEqual([]);
    expect(questions[0].text).toBe('詳細を教えてください');
  });
});

describe('splitIntakeQuestion', () => {
  it('strips the 選択肢 block from prose and returns the parsed options', () => {
    const md = 'これは質問です。\n## 選択肢\n- A\n- B\n';
    const { text, options } = splitIntakeQuestion(md);
    expect(text).toBe('これは質問です。');
    expect(options).toEqual(['A', 'B']);
  });
});
