/**
 * applyPlanModeDirective テスト
 *
 * 実装者/検証者のシステムプロンプトへ、plan.md の有無に応じたモード指示を
 * 先頭に付加する純粋関数の検証。plan なし時は「plan.md がない」旨、plan あり時は
 * 「plan.md に従う」旨を付加し、元プロンプトは保持。対象外ロールは素通し。
 */
import { describe, test, expect, mock } from 'bun:test';

// workflow-context-builder pulls in workflow-file-utils → config/database (a real
// PrismaClient is constructed at import). Stub the file-utils module so importing
// the pure function under test doesn't drag the DB layer in.
// NOTE: mock.module is process-global in bun — mirror EVERY export, or other test
// files importing the missing names in the same run fail with "Export not found".
mock.module('../../services/workflow/workflow-file-utils', () => ({
  readWorkflowFile: () => Promise.resolve(null),
  writeWorkflowFile: () => Promise.resolve(),
  resolveWorkflowDir: () => Promise.resolve(null),
  cleanupRootWorkflowFiles: () => Promise.resolve(),
  extractMarkdownFromOutput: () => null,
}));

const { applyPlanModeDirective } = await import('../../services/workflow/workflow-context-builder');

const BASE = 'あなたはplan.mdに基づいてコードを実装するエンジニアです。';

describe('applyPlanModeDirective', () => {
  test('implementer + plan なし: no-plan 指示を先頭に付加し元文を残す', () => {
    const out = applyPlanModeDirective('implementer', BASE, false);
    expect(out.startsWith('## 実行モード: 調査→実装→検証（plan.md なし）')).toBe(true);
    expect(out).toContain('plan.md がありません');
    expect(out).toContain('research.md とタスク要件');
    expect(out).toContain('プランナーは存在しません');
    expect(out.endsWith(BASE)).toBe(true);
  });

  test('implementer + plan あり: with-plan 指示を付加', () => {
    const out = applyPlanModeDirective('implementer', BASE, true);
    expect(out).toContain('承認済みの plan.md');
    expect(out).toContain('チェックリストに忠実に従って実装');
    expect(out.endsWith(BASE)).toBe(true);
  });

  test('verifier + plan なし: 要件充足ベースへ読み替える指示', () => {
    const out = applyPlanModeDirective('verifier', BASE, false);
    expect(out).toContain('plan.md がありません');
    expect(out).toContain('要件の充足状況');
    expect(out).toContain('タスク要件と research.md');
  });

  test('verifier + plan あり: plan 照合の指示', () => {
    const out = applyPlanModeDirective('verifier', BASE, true);
    expect(out).toContain('plan.md のチェックリストと実装結果を照合');
  });

  test('対象外ロール (researcher/planner/reviewer/auto_verifier) は素通し', () => {
    for (const role of ['researcher', 'planner', 'reviewer', 'auto_verifier']) {
      expect(applyPlanModeDirective(role, BASE, false)).toBe(BASE);
      expect(applyPlanModeDirective(role, BASE, true)).toBe(BASE);
    }
  });
});
