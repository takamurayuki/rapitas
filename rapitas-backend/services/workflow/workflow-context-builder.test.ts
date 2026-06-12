/**
 * Tests for workflow-context-builder.
 *
 * Verifies that buildRoleContext returns role-appropriate context, with special
 * focus on auto_verifier sharing the verifier's section-headed instruction.
 */

import { describe, expect, test } from 'bun:test';
import { buildRoleContext } from './workflow-context-builder';

const TASK = { title: 'Test task', description: 'A test description' };
// Use a path that does not exist so readWorkflowFile returns null for all files.
const NO_DIR = '/nonexistent/workflow/dir';

describe('buildRoleContext', () => {
  describe('auto_verifier role', () => {
    test('includes 検証結果サマリ heading in instruction', async () => {
      const ctx = await buildRoleContext(1, 'auto_verifier', NO_DIR, TASK);
      expect(ctx).toContain('検証結果サマリ');
    });

    test('includes テスト結果 heading in instruction', async () => {
      const ctx = await buildRoleContext(1, 'auto_verifier', NO_DIR, TASK);
      expect(ctx).toContain('テスト結果');
    });

    test('includes チェックリスト heading in instruction', async () => {
      const ctx = await buildRoleContext(1, 'auto_verifier', NO_DIR, TASK);
      expect(ctx).toContain('チェックリスト');
    });

    test('includes task title in context', async () => {
      const ctx = await buildRoleContext(1, 'auto_verifier', NO_DIR, TASK);
      expect(ctx).toContain(TASK.title);
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
