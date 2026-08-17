/**
 * instruction-builder テスト
 *
 * 再実行時に既存の research.md / plan.md があるとき、エージェントへ「まず取得・
 * 評価し、妥当なら再生成しない」よう指示する再利用セクションが注入されることを検証。
 */
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';

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
  await import('../../../../routes/agents/execution/shared/instruction-builder');

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

describe('buildFullInstruction — workflowDisabled（ワークフロー無効モード）', () => {
  test('research.md/plan.md を作らず、verify.md のみを保存する直接実装の指示を注入する', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 601,
      enforceWorkflow: true,
      workflowMode: 'comprehensive',
      workflowDisabled: true,
    });
    expect(out).toContain('ワークフロー無効モード');
    expect(out).toContain('research.md・plan.md は作成せず');
    expect(out).toContain('/workflow/tasks/601/files/verify');
    // Required verify.md sections (must match phase-output-validator's
    // VERIFY_REQUIRED_SECTIONS so the agent's report actually passes the gate).
    expect(out).toContain('## テスト結果');
    expect(out).toContain('## チェックリスト');
    expect(out).toContain('## 検証結果サマリ');
    // The lightweight/standard/comprehensive branches must not ALSO fire.
    expect(out).not.toContain('軽量モード — plan フェーズなし');
    expect(out).not.toContain('### Step 2: 計画 (plan.md の作成)');
  });

  test('workflowDisabled=true が enforceWorkflow=false や workflowMode を上書きする（分岐の優先順位）', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 602,
      enforceWorkflow: false,
      workflowMode: 'lightweight',
      workflowDisabled: true,
    });
    expect(out).toContain('ワークフロー無効モード');
  });

  test('workflowDisabled=false（デフォルト）では注入されない', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 603,
      enforceWorkflow: true,
      workflowMode: 'standard',
    });
    expect(out).not.toContain('ワークフロー無効モード');
  });
});

describe('buildFullInstruction — 仮説台帳コンテキストの注入', () => {
  // Regression: hypotheses stopped being filed entirely once the auto-run
  // orchestrator (the only path that called buildHypothesisContext, via
  // workflow-orchestrator.ts's buildRoleContext) was disabled. This manual
  // "実行" button path builds its own separate prompt and never included the
  // hypothesis-ledger instruction at all — so filing depended entirely on
  // auto-run being active. The caller (execute-route.ts) now pre-computes the
  // context and passes it in as hypothesisContext.
  const FAKE_HYPOTHESIS_CONTEXT =
    '# 仮説台帳 (Hypothesis Ledger)\n\n## 仮説思考の指示（深い推論の核 — 必須）\n- research.md の末尾に必ず `## 仮説` セクションを設けよ。';

  test('standard モードで research.md 手順の後に仮説台帳コンテキストが注入される', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 701,
      enforceWorkflow: true,
      workflowMode: 'standard',
      hypothesisContext: FAKE_HYPOTHESIS_CONTEXT,
    });
    expect(out).toContain('# 仮説台帳 (Hypothesis Ledger)');
    expect(out).toContain('research.md の末尾に必ず `## 仮説` セクションを設けよ');
    // Comes after the research.md template, before plan.md instructions.
    expect(out.indexOf('research.md テンプレート')).toBeLessThan(
      out.indexOf('# 仮説台帳 (Hypothesis Ledger)'),
    );
    expect(out.indexOf('# 仮説台帳 (Hypothesis Ledger)')).toBeLessThan(
      out.indexOf('### Step 2: 計画 (plan.md の作成)'),
    );
  });

  test('lightweight モードでも仮説台帳コンテキストが注入される', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 702,
      enforceWorkflow: true,
      workflowMode: 'lightweight',
      hypothesisContext: FAKE_HYPOTHESIS_CONTEXT,
    });
    expect(out).toContain('# 仮説台帳 (Hypothesis Ledger)');
  });

  test('hypothesisContext 未指定なら何も注入しない', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 703,
      enforceWorkflow: true,
      workflowMode: 'standard',
    });
    expect(out).not.toContain('仮説台帳');
  });

  test('workflowDisabled=true では仮説台帳コンテキストを渡しても注入されない（research.md 自体を作らないモードのため）', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 704,
      enforceWorkflow: true,
      workflowMode: 'standard',
      workflowDisabled: true,
      hypothesisContext: FAKE_HYPOTHESIS_CONTEXT,
    });
    expect(out).not.toContain('仮説台帳');
  });
});

describe('buildFullInstruction — サブタスク分割フラグ連動指示 (RAPITAS_ENABLE_SUBTASK_SPLIT)', () => {
  const ORIGINAL_ENV = process.env.RAPITAS_ENABLE_SUBTASK_SPLIT;

  beforeEach(() => {
    delete process.env.RAPITAS_ENABLE_SUBTASK_SPLIT;
  });

  afterAll(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.RAPITAS_ENABLE_SUBTASK_SPLIT;
    } else {
      process.env.RAPITAS_ENABLE_SUBTASK_SPLIT = ORIGINAL_ENV;
    }
  });

  test('フラグ未設定（既定=無効）なら standard ワークフローに分割禁止指示を注入する', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 801,
      enforceWorkflow: true,
      workflowMode: 'standard',
    });
    expect(out).toContain('## サブタスク分割の禁止');
    expect(out).toContain('POST /tasks による子タスク起票');
    // plan.md テンプレートの後・Step 3 の前に位置すること
    expect(out.indexOf('### Step 2: 計画 (plan.md の作成)')).toBeLessThan(
      out.indexOf('## サブタスク分割の禁止'),
    );
    expect(out.indexOf('## サブタスク分割の禁止')).toBeLessThan(out.indexOf('### Step 3: 終了'));
  });

  test('フラグ有効時は禁止指示を注入しない（現行動作を維持）', () => {
    process.env.RAPITAS_ENABLE_SUBTASK_SPLIT = '1';
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 802,
      enforceWorkflow: true,
      workflowMode: 'standard',
    });
    expect(out).not.toContain('## サブタスク分割の禁止');
  });

  test('lightweight モード（plan フェーズ無し）には注入しない', () => {
    const out = buildFullInstruction({
      taskTitle: 'T',
      taskId: 803,
      enforceWorkflow: true,
      workflowMode: 'lightweight',
    });
    expect(out).not.toContain('## サブタスク分割の禁止');
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
