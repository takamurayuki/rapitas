/**
 * workflow-question-utils.test
 *
 * Unit tests for the pure Q&A parsing helpers (parseIntakeQuestions / splitIntakeQuestion).
 */
import { describe, it, expect } from 'vitest';
import {
  parseIntakeQuestions,
  splitIntakeQuestion,
  parseOptionsBlock,
  stripOptionsBlock,
  composeStructuredAnswer,
} from './workflow-question-utils';

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

const VALID_OPTIONS_MD = [
  '# 仕様確認',
  '',
  '表・見出しを含む本文。',
  '',
  '```json:options',
  JSON.stringify({
    questions: [
      {
        id: 'Q1',
        summary: '達成すべきゴール',
        options: [
          { key: 'A', label: '速度を優先する', consequence: '実装は最小限にする' },
          { key: 'B', label: '品質を優先する', consequence: 'テストを手厚くする' },
        ],
        freeTextRequired: false,
        freeTextReason: null,
      },
      {
        id: 'Q2',
        summary: 'APIキー',
        options: [],
        freeTextRequired: true,
        freeTextReason: '選択肢で表現できない秘匿情報のため',
      },
    ],
  }),
  '```',
].join('\n');

describe('parseOptionsBlock', () => {
  it('parses multiple questions with options and a freeTextRequired question', () => {
    const block = parseOptionsBlock(VALID_OPTIONS_MD);
    expect(block).not.toBeNull();
    expect(block?.questions).toHaveLength(2);
    expect(block?.questions[0]).toEqual({
      id: 'Q1',
      summary: '達成すべきゴール',
      options: [
        { key: 'A', label: '速度を優先する', consequence: '実装は最小限にする' },
        { key: 'B', label: '品質を優先する', consequence: 'テストを手厚くする' },
      ],
      freeTextRequired: false,
      freeTextReason: null,
    });
    expect(block?.questions[1]).toEqual({
      id: 'Q2',
      summary: 'APIキー',
      options: [],
      freeTextRequired: true,
      freeTextReason: '選択肢で表現できない秘匿情報のため',
    });
  });

  it('returns null when the json:options block is missing', () => {
    expect(parseOptionsBlock('# 質問\n選択肢なしの旧形式質問です。')).toBeNull();
  });

  it('returns null for malformed JSON (trailing comma) instead of throwing', () => {
    const md = '```json:options\n{"questions":[{"id":"Q1","summary":"x",}]}\n```';
    expect(() => parseOptionsBlock(md)).not.toThrow();
    expect(parseOptionsBlock(md)).toBeNull();
  });

  it('returns null when questions is an empty array', () => {
    const md = '```json:options\n{"questions":[]}\n```';
    expect(parseOptionsBlock(md)).toBeNull();
  });

  it('returns null when a question has neither options nor freeTextRequired', () => {
    const md =
      '```json:options\n{"questions":[{"id":"Q1","summary":"x","options":[],"freeTextRequired":false}]}\n```';
    expect(parseOptionsBlock(md)).toBeNull();
  });
});

describe('stripOptionsBlock', () => {
  it('removes the json:options fence and keeps the surrounding prose', () => {
    const stripped = stripOptionsBlock(VALID_OPTIONS_MD);
    expect(stripped).toContain('# 仕様確認');
    expect(stripped).toContain('表・見出しを含む本文。');
    expect(stripped).not.toContain('json:options');
    expect(stripped).not.toContain('freeTextRequired');
  });
});

describe('composeStructuredAnswer', () => {
  it('composes selection + free-text answers with the selections audit list', () => {
    const block = parseOptionsBlock(VALID_OPTIONS_MD);
    if (!block) throw new Error('expected a parsed block');
    const { answerText, selections } = composeStructuredAnswer(block.questions, [
      { key: 'B', freeText: '' },
      { key: null, freeText: 'sk-xxxx' },
    ]);
    expect(answerText).toContain('## Q1: 達成すべきゴール');
    expect(answerText).toContain('選択: 品質を優先する（影響: テストを手厚くする）');
    expect(answerText).toContain('## Q2: APIキー');
    expect(answerText).toContain('自由入力: sk-xxxx');
    expect(selections).toEqual([
      { questionId: 'Q1', selectedKey: 'B' },
      { questionId: 'Q2', selectedKey: null },
    ]);
  });
});
