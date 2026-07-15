/**
 * Tests for workflow-context-builder.
 *
 * Verifies that buildRoleContext returns role-appropriate context, with special
 * focus on auto_verifier sharing the verifier's section-headed instruction.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildRoleContext,
  researchModeDirective,
  applyPlanModeDirective,
} from './workflow-context-builder';

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

  describe('premortem (R7)', () => {
    test('planner context mandates a プレモーテム section', async () => {
      const ctx = await buildRoleContext(1, 'planner', NO_DIR, TASK);
      expect(ctx).toContain('## プレモーテム');
      expect(ctx).toContain('失敗原因を3つ');
    });

    test('verifier context mandates the premortem cross-check', async () => {
      const ctx = await buildRoleContext(1, 'verifier', NO_DIR, TASK);
      expect(ctx).toContain('プレモーテム照合');
    });

    test('english planner variant carries the premortem too', async () => {
      const ctx = await buildRoleContext(1, 'planner', NO_DIR, TASK, 'en');
      expect(ctx).toContain('Premortem (REQUIRED)');
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

describe('applyPlanModeDirective', () => {
  test('implementer without a plan gets the plan-less directive prepended', () => {
    const out = applyPlanModeDirective('implementer', 'BASE PROMPT', false);
    expect(out.startsWith('## 実行モード: 調査→実装→検証（plan.md なし）')).toBe(true);
    expect(out).toContain('plan.md を新規作成・保存しないでください');
    expect(out.endsWith('BASE PROMPT')).toBe(true);
  });

  test('implementer with a plan gets the with-plan directive prepended', () => {
    const out = applyPlanModeDirective('implementer', 'BASE PROMPT', true);
    expect(out.startsWith('## 実行モード: 計画あり（plan.md）')).toBe(true);
    expect(out).toContain('承認済みの plan.md');
    expect(out).not.toContain('plan.md を新規作成・保存しないでください');
  });

  test('verifier without a plan gets the plan-less verifier directive prepended', () => {
    const out = applyPlanModeDirective('verifier', 'BASE PROMPT', false);
    expect(out).toContain('検証の基準は **タスク要件と research.md** です');
  });

  test('verifier with a plan gets the with-plan verifier directive prepended', () => {
    const out = applyPlanModeDirective('verifier', 'BASE PROMPT', true);
    expect(out).toContain('plan.md のチェックリストと実装結果を照合して検証');
  });

  test('every other role (researcher/planner/reviewer/auto_verifier) is left unchanged', () => {
    for (const role of ['researcher', 'planner', 'reviewer', 'auto_verifier']) {
      expect(applyPlanModeDirective(role, 'BASE PROMPT', true)).toBe('BASE PROMPT');
      expect(applyPlanModeDirective(role, 'BASE PROMPT', false)).toBe('BASE PROMPT');
    }
  });
});
