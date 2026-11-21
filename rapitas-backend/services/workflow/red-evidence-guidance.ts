/**
 * red-evidence-guidance
 *
 * How a plan proves a test fails without the fix (RED), and how the verifier
 * judges that proof. Not responsible for running anything — the red-state
 * gate (services/agents/verification/red-state-check.ts) does that.
 *
 * NOTE: Task 1521's plan (2026-11-21) said "record T1 RED before the fix and
 * GREEN after". A run made before the fix is a past event: the verifier can
 * only re-run what exists now, so every round reported "pre-fix run history
 * unconfirmed" and the item could never close. RED is now asked for in forms
 * anyone can re-run at verify time.
 */

const PLANNER_JA = `## RED の示し方
「修正しなければテストが失敗する」ことは、検証の時点で**再実行できる形**で示す計画にしてください。
- 使える形: 使い捨てのコピーで修正を外して RED、戻して GREEN になる対照。または、変更したテストを差分の基準コミットに当てて走らせる red-state 検査（仕組み側が自動で実行する）。
- 使わない形: 「修正前に実行した記録」「先行履歴」のような過去の実行の記録。後から誰も作り直せないため、完了条件やチェックリストの項目にしない。`;

const PLANNER_EN = `## RED の示し方 (how RED is shown)
Plan to show "the test fails without the fix" in a form that can be **re-run at verify time**.
- Use: a control that removes the fix in a disposable copy (RED) and restores it (GREEN), or the red-state gate, which runs the changed tests against the diff's base commit automatically.
- Do not use: a record of a run made before the fix ("pre-fix history"). Nobody can recreate it later, so never make it a done condition or checklist item.`;

const VERIFIER_JA = `
### RED の判定
- 「修正前に実行した記録」や「先行履歴」が見当たらないことだけを理由に ❌ にしない。過去の実行は作り直せない。
- RED は、red-state 検査の結果、または使い捨てのコピーで修正を外す対照を今回実行した結果で判定する。どちらかで RED→GREEN を確認できれば、計画に「修正前の記録」と書かれていても充足として扱う。`;

const VERIFIER_EN = `
### Judging RED
- Do not mark ❌ only because a pre-fix run record or "history" is missing; a past run cannot be recreated.
- Judge RED by the red-state gate's result, or by running a control now that removes the fix in a disposable copy. If either shows RED → GREEN, treat the item as met even when the plan asked for a pre-fix record.`;

/**
 * Planner directive on re-runnable RED evidence.
 *
 * @param language - Prompt language / プロンプトの言語
 * @returns The directive / 指示文
 */
export function plannerRedEvidenceGuidance(language: string): string {
  return language === 'en' ? PLANNER_EN : PLANNER_JA;
}

/**
 * Verifier rule for judging RED evidence.
 *
 * @param language - Prompt language / プロンプトの言語
 * @returns The rule / 判定ルール
 */
export function verifierRedEvidenceGuidance(language: string): string {
  return language === 'en' ? VERIFIER_EN : VERIFIER_JA;
}
