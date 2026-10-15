/**
 * intake-question-template.test
 *
 * Unit tests for the question.md body builder.
 */
import { describe, it, expect } from 'bun:test';
import {
  buildIntakeQuestion,
  intakeGoalOptions,
  INTAKE_AUTO_ADOPT_REASON,
} from './intake-question-template';
import {
  parseQuestionOptionsBlock,
  isQuestionBlockEligibleForAutoAnswer,
} from '../workflow/question-options-parser';

describe('buildIntakeQuestion autoAdopt (2026-09-23: auto-filed Ideas run at minimal scope)', () => {
  const questions = [
    {
      field: 'goals',
      question: 'ゴールは？',
      options: ['可視化のみ', '自動リカバリまで', '再実行順序の最適化'],
      recommendedIndex: 0,
    },
    {
      field: 'constraints',
      question: '規模は？',
      options: ['<500 件', '5000+ 件'],
      recommendedIndex: 1,
    },
  ];

  it('emits a json:options block the auto-answer heal pass accepts', () => {
    const md = buildIntakeQuestion({
      title: 'T',
      missing: ['goals'],
      reasons: [],
      questions,
      autoAdopt: true,
    });
    const block = parseQuestionOptionsBlock(md);
    expect(block).not.toBeNull();
    expect(block!.questions.map((q) => q.id)).toEqual(['Q1', 'Q2']);
    expect(block!.questions[0].recommended).toBe('A');
    expect(block!.questions[1].recommended).toBe('B');
    expect(block!.questions[0].options.map((o) => o.label)).toEqual(questions[0].options);
    expect(block!.questions[0].recommendedReason).toBe(INTAKE_AUTO_ADOPT_REASON);
    expect(isQuestionBlockEligibleForAutoAnswer(block!)).toEqual({ eligible: true });
  });

  it('keeps the human-readable headings the intake UI parses, before the block', () => {
    const md = buildIntakeQuestion({
      title: 'T',
      missing: ['goals'],
      reasons: [],
      questions,
      autoAdopt: true,
    });
    expect(md.indexOf('## 質問1')).toBeGreaterThan(-1);
    expect(md.indexOf('## 回答方法')).toBeLessThan(md.indexOf('```json:options'));
  });

  it('emits no block for human-filed tasks (autoAdopt unset)', () => {
    const md = buildIntakeQuestion({ title: 'T', missing: ['goals'], reasons: [], questions });
    expect(md).not.toContain('json:options');
    expect(parseQuestionOptionsBlock(md)).toBeNull();
  });

  it('clamps an out-of-range recommendedIndex and defaults to the first option', () => {
    const md = buildIntakeQuestion({
      title: 'T',
      missing: ['goals'],
      reasons: [],
      questions: [
        { field: 'goals', question: 'a', options: ['x', 'y'], recommendedIndex: 9 },
        { field: 'goals', question: 'b', options: ['p', 'q'] },
      ],
      autoAdopt: true,
    });
    const block = parseQuestionOptionsBlock(md)!;
    expect(block.questions[0].recommended).toBe('B');
    expect(block.questions[1].recommended).toBe('A');
  });
});

describe('buildIntakeQuestion', () => {
  it('renders one 質問 block per missing field (1問1答), each with choices', () => {
    const md = buildIntakeQuestion({
      title: 'Add login',
      missing: ['goals', 'acceptanceCriteria'],
      reasons: ['説明が短く (10文字)、意図を機械的に判断できません。'],
    });
    expect(md).toContain('# 仕様確認');
    expect(md).toContain('Add login');
    // One numbered question per missing field, labelled with the field.
    expect(md).toContain('## 質問1');
    expect(md).toContain('## 質問2');
    expect(md).toContain('goals');
    expect(md).toContain('acceptanceCriteria');
    expect(md).toContain('### 選択肢');
    expect(md).toContain('## 回答方法');
  });

  it('renders AI-provided questions verbatim when supplied', () => {
    const md = buildIntakeQuestion({
      title: 'T',
      missing: ['goals'],
      reasons: [],
      questions: [
        { field: 'goals', question: '速度と品質どちらを優先？', options: ['速度', '品質'] },
      ],
    });
    expect(md).toContain('## 質問1');
    expect(md).toContain('速度と品質どちらを優先？');
    expect(md).toContain('- 速度');
    expect(md).toContain('- 品質');
  });

  it('falls back to a single goal question when nothing is flagged missing', () => {
    const md = buildIntakeQuestion({ title: '[Perf] x', missing: [], reasons: [] });
    expect(md).toContain('## 質問1');
    expect(md).toMatch(/実行時間|レスポンス|スループット|メモリ/);
    expect(md).toContain('## 回答方法');
  });
});

describe('intakeGoalOptions', () => {
  it('returns perf-flavored options for a [Perf] task', () => {
    const opts = intakeGoalOptions('[Perf] SSOT スクリプト最適化');
    expect(opts.length).toBeGreaterThanOrEqual(2);
    expect(opts.join(' ')).toMatch(/実行時間|スループット|メモリ/);
  });

  it('returns refactor-flavored options for a [Refactor] task', () => {
    const opts = intakeGoalOptions('[Refactor] 型ガードの共通化');
    expect(opts.join(' ')).toMatch(/保守性|型安全|テスト容易/);
  });

  it('falls back to generic options for an untyped title', () => {
    const opts = intakeGoalOptions('なにかのタスク');
    expect(opts.length).toBeGreaterThanOrEqual(2);
  });
});
