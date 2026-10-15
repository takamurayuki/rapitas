/**
 * verify-verdict-scope-guidance
 *
 * ja/en prompt text stating WHICH findings may change verify.md's overall
 * verdict. Extracted from workflow-role-prompts.ts (which is past the
 * COMPONENT_SPLITTING_POLICY line budget) the same way
 * workflow-question-format-guidance.ts was.
 *
 * Why it exists. Measured over all 534 verify_repair bounces: 162 of them
 * (30%, the second-largest category after the adversarial diff review) carry
 * the reason "verify.md explicitly reports a failed or partial overall
 * verdict; repair is required." They span 68 tasks, and 15 of those bounced
 * three or more times on this one reason — #907 and #980 fifteen times each,
 * #973 twelve, #881 eight.
 *
 * What the verifier had actually marked, in the surviving reports:
 *
 *   #881 「Full Suite (Advisory) の1件が失敗のまま。advisory かつ develop 起因で
 *         本タスクの変更と無関係」, and 「パフォーマンス影響 ⚠️ 未計測」
 *   #896 「plan.md自身がスコープ外と明記済みで、懸念#9903で追跡中」
 *
 * An advisory job failing for a reason that predates the diff, and an item the
 * plan itself declared out of scope, are not things the implementer can fix.
 * Each bounce re-ran the implementer with nothing to repair, which is why the
 * same task bounced on the same reason up to fifteen times.
 *
 * The existing "publication steps are out of scope" section (same file) is the
 * precedent: the fix belongs with the author of the verdict, not with a gate
 * exemption, because a gate that forgives a partial verdict would also forgive
 * a real one.
 */

export const VERDICT_SCOPE_GUIDANCE_JA =
  '\n### 全体判定の範囲 ★重要\n' +
  '- 全体判定が `⚠️ 一部失敗` / `❌ 検証失敗` になるのは、**本タスクの受入基準が未達**か、**本タスクの差分が原因で落ちているチェックがある**場合だけです。\n' +
  '- 次のものは `## 残課題 / フォローアップ` に記録した上で、全体判定は `✅ 検証成功` のままにしてください（実装者が直せるものが無いのに修復サイクルを回すことになります）:\n' +
  '  - advisory（必須でない）ジョブの失敗、および本タスクの差分より前から落ちている既存の失敗。**チェック名と「差分より前から落ちている」根拠（ベース側の実行結果やコミット）を必ず書く**こと。根拠を書けない場合は実失敗として扱ってください。\n' +
  '  - plan.md 自身がスコープ外と宣言している項目、および別タスク・懸念として追跡されている項目。追跡先の id を書き、行は `➖ 対象外（理由）` で記載します。\n' +
  '  - 対応する受入基準が無い注記（未計測の性能影響など）。\n' +
  '- 実測（差し戻し534件）: 162件（30%）がこの「一部失敗の宣言」による差し戻しで、68タスク中15タスクが同じ理由で3回以上繰り返しました（最多は #907 と #980 が各15回）。#881 は「advisory かつ develop 起因で本タスクの変更と無関係」な失敗、#896 は「plan.md がスコープ外と明記済み」の項目で、いずれも直す対象がありませんでした。\n';

export const VERDICT_SCOPE_GUIDANCE_EN =
  '\n### What the overall verdict covers ★important\n' +
  "- The overall verdict is `⚠️ Partial` / `❌ Fail` ONLY when **an acceptance criterion of THIS task is unmet** or **a check is failing because of THIS task's diff**.\n" +
  '- Record the following under `## 残課題 / フォローアップ` and keep the verdict `✅ Pass` (otherwise the repair cycle re-runs the implementer with nothing to fix):\n' +
  '  - A failing advisory (non-required) job, or a pre-existing failure that predates this diff. **Name the check and give the evidence that it predates the diff** (a base-side run or commit). If you cannot give that evidence, treat it as a real failure.\n' +
  '  - An item plan.md itself declares out of scope, or one tracked as another task/concern — cite the tracking id and write the row as `➖ N/A (reason)`.\n' +
  '  - A note with no acceptance criterion behind it (an unmeasured performance impact, say).\n' +
  '- Measured across all 534 repair bounces: 162 (30%) were this partial-verdict bounce, spanning 68 tasks, 15 of which repeated it three or more times (#907 and #980 fifteen times each). #881 was a failure that was "advisory, caused by develop, unrelated to this task\'s change"; #896 was an item "plan.md itself declares out of scope" — neither had anything to repair.\n';
