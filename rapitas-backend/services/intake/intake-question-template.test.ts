/**
 * intake-question-template.test
 *
 * Unit tests for the question.md body builder.
 */
import { describe, it, expect } from 'bun:test';
import { buildIntakeQuestion } from './intake-question-template';

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
});
