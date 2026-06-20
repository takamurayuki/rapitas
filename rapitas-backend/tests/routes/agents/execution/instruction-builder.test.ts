/**
 * instruction-builder テスト
 *
 * 再実行時に既存の research.md / plan.md があるとき、エージェントへ「まず取得・
 * 評価し、妥当なら再生成しない」よう指示する再利用セクションが注入されることを検証。
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../../../config/database', () => ({
  prisma: {},
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../../config/logger', () => {
  const noop = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
  return {
    createLogger: () => noop,
    logger: noop,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const { buildFullInstruction } =
  await import('../../../../routes/agents/execution/instruction-builder');

describe('buildFullInstruction — 既存成果物の再利用指示', () => {
  test('hasResearch/hasPlan のとき再利用セクションを注入すること', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskDescription: 'D',
      taskId: 234,
      enforceWorkflow: true,
      hasResearch: true,
      hasPlan: true,
    });
    expect(out).toContain('## 既存の調査・計画の再利用'); // セクション見出し
    expect(out).toContain('**research.md / plan.md**'); // 両方を太字で列挙
    expect(out).toContain('/workflow/tasks/234/files'); // 取得用 curl GET
    expect(out).toContain('再保存しない');
  });

  test('片方だけ存在する場合はそのファイル名のみ挙げること', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 234,
      enforceWorkflow: true,
      hasResearch: true,
      hasPlan: false,
    });
    expect(out).toContain('**research.md**');
    expect(out).not.toContain('**research.md / plan.md**'); // plan は列挙されない
  });

  test('既存成果物が無ければ再利用セクションを注入しないこと', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 234,
      enforceWorkflow: true,
      hasResearch: false,
      hasPlan: false,
    });
    expect(out).not.toContain('## 既存の調査・計画の再利用'); // セクション見出しは無い
  });

  test('enforceWorkflow=false でも既存があれば再利用セクションは出ること', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 234,
      enforceWorkflow: false,
      hasPlan: true,
    });
    expect(out).toContain('## 既存の調査・計画の再利用');
    expect(out).not.toContain('必須ワークフロー'); // 強制ワークフロー注入は無い
  });
});
