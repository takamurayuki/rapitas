/**
 * Tests for workflow-context-builder.
 *
 * Verifies that buildRoleContext returns role-appropriate context, with special
 * focus on auto_verifier sharing the verifier's section-headed instruction.
 */

import { describe, expect, test } from 'bun:test';
import { buildRoleContext, researchModeDirective } from './workflow-context-builder';

const TASK = { title: 'Test task', description: 'A test description' };
// Use a path that does not exist so readWorkflowFile returns null for all files.
const NO_DIR = '/nonexistent/workflow/dir';

describe('buildRoleContext', () => {
  describe('auto_verifier role', () => {
    test.each([
      { name: '検証結果サマリ heading in instruction', expected: '検証結果サマリ' },
      { name: 'テスト結果 heading in instruction', expected: 'テスト結果' },
      { name: 'チェックリスト heading in instruction', expected: 'チェックリスト' },
      { name: 'task title in context', expected: TASK.title },
    ])('includes $name', async ({ expected }) => {
      const ctx = await buildRoleContext(1, 'auto_verifier', NO_DIR, TASK);
      expect(ctx).toContain(expected);
    });
  });

  describe('verifier role', () => {
    test('includes the same 3 required section headings', async () => {
      const ctx = await buildRoleContext(1, 'verifier', NO_DIR, TASK);
      expect(ctx).toContain('検証結果サマリ');
      expect(ctx).toContain('テスト結果');
      expect(ctx).toContain('チェックリスト');
    });
  });

  describe('auto_verifier and verifier produce equivalent instructions', () => {
    test('auto_verifier instruction text equals verifier instruction text', async () => {
      const autoCtx = await buildRoleContext(1, 'auto_verifier', NO_DIR, TASK);
      const verifierCtx = await buildRoleContext(1, 'verifier', NO_DIR, TASK);
      // Both roles fall through to the same code block, so their outputs must be identical.
      expect(autoCtx).toBe(verifierCtx);
    });
  });
});

describe('researchModeDirective', () => {
  test('lightweight declares no plan phase and demands implementation-ready research', () => {
    const d = researchModeDirective('lightweight', 'ja');
    expect(d).toContain('軽量');
    expect(d).toContain('計画(plan)フェーズはありません');
  });

  test('standard / comprehensive declare a following plan phase', () => {
    expect(researchModeDirective('standard', 'ja')).toContain('計画(plan)フェーズ');
    expect(researchModeDirective('comprehensive', 'ja')).toContain('計画(plan)フェーズ');
  });

  test('english variants', () => {
    expect(researchModeDirective('lightweight', 'en')).toContain('no planning phase');
    expect(researchModeDirective('standard', 'en')).toContain('planning phase will run');
  });
});
