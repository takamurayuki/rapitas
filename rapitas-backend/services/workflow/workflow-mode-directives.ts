/**
 * Workflow Mode Directives
 *
 * Plan/no-plan mode directives: the researcher's mode-aware framing and the
 * high-priority directives prepended to the implementer/verifier system
 * prompt. Does not build role contexts — only supplies mode-dependent text.
 */

/**
 * Mode-aware framing for the RESEARCHER. In lightweight mode no plan phase
 * follows, so research must be implementation-ready (concrete files / approach /
 * test plan); in plan modes research may defer detailed steps to the planner.
 *
 * @param mode - The resolved workflow mode. / 解決済みワークフローモード
 * @param language - Output language. / 出力言語
 * @returns A directive block prepended to the researcher context. / 調査者向け指示ブロック
 */
export function researchModeDirective(
  mode: 'lightweight' | 'standard' | 'comprehensive',
  language: 'ja' | 'en' = 'ja',
): string {
  if (mode === 'lightweight') {
    return language === 'ja'
      ? `## 実行モード: 軽量（plan フェーズなし）
このタスクは軽量モードで実行され、**後続に計画(plan)フェーズはありません**。調査結果はそのまま実装に使えるよう、**変更対象ファイル・具体的な修正方針・テスト方針**まで具体化してください。判断を後続の計画へ先送りしないでください。`
      : `## Execution mode: lightweight (NO plan phase)
This task runs in lightweight mode — **no planning phase follows**. Make the research implementation-ready: name the target files, the concrete fix approach, and the test plan. Do NOT defer decisions to a later plan.`;
  }
  return language === 'ja'
    ? `## 実行モード: ${mode === 'comprehensive' ? '詳細' : '標準'}（plan フェーズあり）
このタスクは後続で**計画(plan)フェーズ**が実行されます。調査では事実・依存関係・リスク・既存実装の把握に集中し、詳細な実装手順は計画フェーズに委ねて構いません。`
    : `## Execution mode: ${mode} (plan phase follows)
A planning phase will run after this. Focus the research on facts, dependencies, risks, and existing implementation; the detailed implementation steps can be left to the plan phase.`;
}

// High-priority mode directives prepended to the implementer/verifier SYSTEM
// prompt. The seed role prompts are written around plan.md, but the lightweight
// (research→implement→verify) workflow produces no plan. These directives are
// authoritative ("overrides any other instruction") so they correct an
// already-stored / user-edited DB prompt without rewriting it, and complement
// the plan-agnostic seed for fresh installs.

const IMPLEMENTER_NO_PLAN_DIRECTIVE = `## 実行モード: 調査→実装→検証（plan.md なし） — 他のどの指示よりも優先

このタスクには **plan.md がありません**（軽量ワークフローは計画フェーズを実施しません）。
**あなたは「実装」フェーズの担当です。今すぐコードを実装してください。**
- **plan.md を新規作成・保存しないでください。** あなたの成果物は plan.md ではなく**コードの変更**です。research.md とタスク要件を読んだら、調査やレポートで止まらず **Write/Edit でコードを編集**してください。CLAUDE.md に「Step 2 — Plan / plan.md を作成」とあっても、このフェーズでは従わないでください（フェーズ遷移は orchestrator が管理します）。
以下のロール説明に「plan.md」「承認された計画」「計画のチェックリスト」「プランナーへの質問」等があっても、次のとおり読み替えてください:
- 実装の根拠は **research.md とタスク要件** です。「計画に従う」ではなく、調査結果とタスク内容に基づいて実装してください。
- plan.md のチェックリストは存在しません。**タスク要件を満たすこと**を完了基準にしてください。
- **プランナーは存在しません**。既存コード・型・慣例から合理的に導ける判断は自分で行い、根拠を記録してください。**複数の妥当な選択肢があり、選択がタスクの目的自体を左右する場合のみ**、question.md に記録して停止してください（回答するのはユーザーです）。
- スコープ厳守・スコープ外変更の禁止・品質基準・セーフガード（テスト/型/ESLint）は通常どおり適用します。`;

const IMPLEMENTER_WITH_PLAN_DIRECTIVE = `## 実行モード: 計画あり（plan.md） — 他のどの指示よりも優先

このタスクには **承認済みの plan.md** があります。plan.md の計画とチェックリストに忠実に従って実装してください。`;

const VERIFIER_NO_PLAN_DIRECTIVE = `## 実行モード: 調査→実装→検証（plan.md なし） — 他のどの指示よりも優先

このタスクには **plan.md がありません**。以下のロール説明に「plan.md」「計画チェックリスト消化状況」等があれば読み替えてください:
- 検証の基準は **タスク要件と research.md** です。plan.md との照合ではなく、タスク要件・調査内容に対する充足状況を評価してください。
- 見出しは \`## チェックリスト消化状況\` のまま維持し、その内容として**タスク要件・調査内容に対する充足状況（✅/❌）**を記載してください（見出しを「要件の充足状況」等へ改名しない — 機械ゲートが見出し文字列を解析します）。
- それ以外（変更ファイル列挙・テスト結果・セキュリティ/品質チェック・未解決懸念）は通常どおり報告します。`;

const VERIFIER_WITH_PLAN_DIRECTIVE = `## 実行モード: 計画あり（plan.md） — 他のどの指示よりも優先

このタスクには **plan.md** があります。plan.md のチェックリストと実装結果を照合して検証してください。`;

/**
 * Prepend a plan-mode directive to the implementer/verifier system prompt.
 *
 * No-ops for other roles (the planner only runs in plan-producing modes,
 * researcher has no plan dependency). The directive is authoritative so it fixes
 * the behaviour regardless of what the stored DB prompt says.
 *
 * @param role - The workflow role whose system prompt is being prepared. / 対象ロール
 * @param systemPrompt - The role's system prompt content (from DB). / DB由来のシステムプロンプト
 * @param hasPlan - Whether plan.md exists for this task. / plan.md の有無
 * @returns The system prompt with the mode directive prepended (or unchanged). / モード指示を付加したプロンプト
 */
export function applyPlanModeDirective(
  role: string,
  systemPrompt: string,
  hasPlan: boolean,
): string {
  let directive: string | null = null;
  if (role === 'implementer') {
    directive = hasPlan ? IMPLEMENTER_WITH_PLAN_DIRECTIVE : IMPLEMENTER_NO_PLAN_DIRECTIVE;
  } else if (role === 'verifier') {
    directive = hasPlan ? VERIFIER_WITH_PLAN_DIRECTIVE : VERIFIER_NO_PLAN_DIRECTIVE;
  }
  return directive ? `${directive}\n\n${systemPrompt}` : systemPrompt;
}
