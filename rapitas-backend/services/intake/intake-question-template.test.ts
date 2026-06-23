/**
 * intake-question-template.test
 *
 * Unit tests for the question.md body builder.
 */
import { describe, it, expect } from 'bun:test';
import { buildIntakeQuestion, intakeGoalOptions } from './intake-question-template';

describe('buildIntakeQuestion', () => {
  it('includes the title, missing fields, and reasons', () => {
    const md = buildIntakeQuestion({
      title: 'Add login',
      missing: ['goals', 'acceptanceCriteria'],
      reasons: ['説明が短く (10文字)、意図を機械的に判断できません。'],
    });
    expect(md).toContain('# 仕様確認');
    expect(md).toContain('Add login');
    expect(md).toContain('goals');
    expect(md).toContain('acceptanceCriteria');
    expect(md).toContain('説明が短く');
    expect(md).toContain('## 回答方法');
  });

  it('omits the missing-fields section when nothing is missing', () => {
    const md = buildIntakeQuestion({ title: 'T', missing: [], reasons: [] });
    expect(md).not.toContain('## 不足している項目');
    expect(md).not.toContain('## 判定理由');
    // Always keeps the answer guidance.
    expect(md).toContain('## 回答方法');
  });

  it('renders a selectable 選択肢 block with goal options', () => {
    const md = buildIntakeQuestion({
      title: '[Perf] SSOT スクリプト最適化',
      missing: ['goals'],
      reasons: [],
    });
    expect(md).toContain('## 選択肢');
    // Perf task → speed/memory/throughput style options.
    expect(md).toMatch(/実行時間|レスポンス|スループット|メモリ/);
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
