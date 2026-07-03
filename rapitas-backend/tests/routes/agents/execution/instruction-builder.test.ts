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

describe('buildFullInstruction — workflowMode による research-vs-implement ダウングレード', () => {
  test('lightweight: 計画フェーズが無い旨と「実装を始めない」制約を注入し、plan.md 作成を明示的に禁止する', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 501,
      enforceWorkflow: true,
      workflowMode: 'lightweight',
    });
    expect(out).toContain('軽量モード');
    expect(out).toContain('plan.md は作成しません');
    expect(out).toContain('この実行で実装(コード変更)を始めないでください');
    // standard モード専用の plan.md 作成手順（Step 2: 計画）は注入されないこと
    expect(out).not.toContain('### Step 2: 計画 (plan.md の作成)');
  });

  test('standard（デフォルト）: リサーチャー/プランナー兼任の完全ワークフローを注入する', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 502,
      enforceWorkflow: true,
      // workflowMode 省略 → デフォルト 'standard'
    });
    expect(out).toContain('あなたは「リサーチャー」と「プランナー」のロールを兼ねます');
    expect(out).toContain('### Step 2: 計画 (plan.md の作成)');
    // lightweight 専用の見出しは出ない
    expect(out).not.toContain('軽量モード — plan フェーズなし');
  });

  test('comprehensive も standard と同じ完全ワークフロー分岐を通る（lightweight以外は同一パス）', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 503,
      enforceWorkflow: true,
      workflowMode: 'comprehensive',
    });
    expect(out).toContain('### Step 2: 計画 (plan.md の作成)');
    expect(out).not.toContain('軽量モード — plan フェーズなし');
  });

  test('enforceWorkflow=false のときは workflowMode に関わらずワークフロー注入自体が無い', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 504,
      enforceWorkflow: false,
      workflowMode: 'lightweight',
    });
    expect(out).not.toContain('必須ワークフロー');
    expect(out).not.toContain('軽量モード');
  });

  test('taskId 未指定のときはワークフロー注入自体が無い（taskId が無いと workflow API を参照できない）', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      enforceWorkflow: true,
      workflowMode: 'lightweight',
    });
    expect(out).not.toContain('必須ワークフロー');
  });
});

describe('buildFullInstruction — taskSpec（goals/constraints/acceptanceCriteria）の注入', () => {
  test('goals/constraints/acceptanceCriteria が全て指定されると強調セクションを構築する', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskSpec: {
        goals: ['ゴールA'],
        constraints: ['制約B'],
        acceptanceCriteria: ['基準C'],
      },
    });
    expect(out).toContain('## タスク仕様（必達）');
    expect(out).toContain('### 達成すべきゴール');
    expect(out).toContain('1. ゴールA');
    expect(out).toContain('### 制約条件（違反不可）');
    expect(out).toContain('- ⚠️ 制約B');
    expect(out).toContain('### 受入基準（すべて満たすこと）');
    expect(out).toContain('- ✅ 基準C');
  });

  test('taskSpec 未指定なら仕様セクションは注入されない', () => {
    const out = buildFullInstruction({ taskTitle: 'T' });
    expect(out).not.toContain('## タスク仕様（必達）');
  });

  test('空配列だけの taskSpec も注入されない（全項目0件）', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskSpec: { goals: [], constraints: [], acceptanceCriteria: [] },
    });
    expect(out).not.toContain('## タスク仕様（必達）');
  });
});
