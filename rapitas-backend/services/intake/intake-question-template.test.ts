/**
 * intake-question-template.test
 *
 * Unit tests for the question.md body builder.
 */
import { describe, it, expect } from 'bun:test';
import { buildIntakeQuestion, intakeGoalOptions } from './intake-question-template';

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
