/**
 * Workflow Question Format Guidance
 *
 * ja/en prompt text describing the `json:options` machine-readable question
 * format (researcher/planner/implementer共通). Extracted from
 * workflow-role-prompts.ts (task 721) to keep that file under the
 * COMPONENT_SPLITTING_POLICY line budget — the prompt text itself is
 * unchanged in meaning, only relocated.
 */

// question.md の機械可読フォーマット規約（researcher/planner/implementer 共通）。
// UI（StructuredQuestionFlow）がこの `json:options` フェンスブロックを解析して
// 選択肢ボタンを描画する。無ければ旧形式（`## 質問N`/自由記述）にフォールバックする
// ため必須ではないが、ユーザーの回答負担を選択のみに抑えるため既定で促す。
export const QUESTION_FORMAT_GUIDANCE_JA =
  '## question.md 保存時の推奨フォーマット（機械可読ブロック・選択肢UI用）\n' +
  'question.md を保存する場合、質問文（Markdownの表・見出し等は自由に使ってよい）に加えて、末尾に以下の `json:options` フェンスブロックを1個だけ付与してください（UIがこれを解析し、ユーザーは自由記述ではなくボタンで回答できます）。\n\n' +
  '```json:options\n' +
  '{ "questions": [ { "id": "Q1", "summary": "一行要約", "options": [ {"key":"A","label":"選択肢の文言","consequence":"選んだ場合の変更範囲を1行で"} ], "freeTextRequired": false, "freeTextReason": null, "recommended": "A", "recommendedReason": "推奨理由を1〜2文で（plan.mdの該当箇所・実測値・テスト結果のいずれかを引用）" } ] }\n' +
  '```\n\n' +
  '- 1論点 = 1つの `questions[]` 要素。各質問に **2〜4個の `options`** を付け、`key` は質問内で一意にする。\n' +
  '- `freeTextRequired: true` は「選択肢で表現できない入力（APIキー・ファイルパス等の秘匿・可変情報）」の場合のみ使用し、理由を `freeTextReason` に1行で明記する。それ以外の論点は必ず選択肢で表現すること。\n' +
  '- `consequence` にはその選択肢を選んだ場合の影響・変更範囲を1行で書く。\n' +
  '- **`recommended` と `recommendedReason` は必須。** `recommended` には自分ならどの `options` を選ぶか、その `key` を1つ書く。`recommendedReason` には根拠を1〜2文で書き、「低リスクだから」のような一般論ではなく、plan.md の該当箇所・実測値・テスト結果のいずれかを具体的に引用する。判断できない場合は空欄にせず、`freeTextRequired: true` にしてその理由を `freeTextReason` に書く。\n' +
  '- ゲートの検証条件・しきい値を変える選択肢には `mutatesGate: true` を付与する。この指定がある選択肢は、推奨に指定されていても無応答タイムアウトによる自動採用の対象外になり、人間の回答を待つ。\n' +
  '- **運用者（人間）がワークフローの外で作業しないと進めない選択肢には `requiresOperatorAction: true` を付与する。** 例: プロジェクトルートでの依存追加、他タスクのPRのマージ、認証情報の発行。この指定がある選択肢は推奨に指定されていても自動採用されず（採用しても作業は行われないため）、その質問は「エージェントの質問回数」ではなく「人の作業待ち」として別枠で数えられる。実測 #1215: 「#1214 をマージしてから再開する」が15分のタイムアウトで自動採用されたが誰もマージせず、受入条件0/3で差し戻しになった。\n' +
  '- **`planRevision: true` は、完了条件そのものを変えるか、計画が採用した方針を別案に替える選択肢にだけ付ける。** `planImpact` に `criteria`、`approach`、`none` のいずれかを指定し、影響を明示する。\n' +
  '  - 付ける例は、完了条件を静的検証に変更する（`"planImpact": "criteria"`）か、方式Aの計画を方式Bへ全面的に替える（`"planImpact": "approach"`）場合。\n' +
  '  - 付けない例は、既存の方針内でテストデータの作り方を選ぶ場合や、別のPRで修正済みと伝える場合。計画内で続行できる回答には `"planImpact": "none"` を指定し、回答を引き継いで実装を再開する。\n' +
  '  - 計画外のファイル（保護パスを含む）を許可する場合も付けない。例は回帰試験のために追加変更を求める `"planImpact": "none", "grantsFiles": ["src/example.ts"]`。変更理由は `consequence` に書く。自己承認を防ぐため、ファイル名を確認した運用者の署名付き承認が必要。\n' +
  '- 人の回答で `resumeImplementer: true` を指定できるのは、改訂フラグだけの旧形式の選択肢を計画を維持して処理する場合。明示された完了条件や方針の変更は改訂する。ゲート変更にも上書きは適用されない。\n' +
  '- ブロックは1個のみ保存する（複数あるとUIは最初の1個のみ使用する）。\n' +
  '- `questions` と同じ階層（トップレベル）に任意で `kind` を指定できる。plan フェーズから質問する場合は `"kind": "execution_continuation"`（実装続行のための確認）または `"kind": "completion_confirmation"`（完了直前の最終確認）のいずれかを指定すること。`"kind": "spec_change"` はresearch開始前のintake専用であり、それ以外のフェーズで指定しても無視される。';

export const QUESTION_FORMAT_GUIDANCE_EN =
  '## Recommended format when saving question.md (machine-readable block for the choice UI)\n' +
  'When saving question.md, in addition to the question prose (Markdown tables/headings are fine), append EXACTLY ONE `json:options` fenced block at the end (the UI parses it so the user can answer by clicking a button instead of typing).\n\n' +
  '```json:options\n' +
  '{ "questions": [ { "id": "Q1", "summary": "one-line summary", "options": [ {"key":"A","label":"option text","consequence":"one-line impact if chosen"} ], "freeTextRequired": false, "freeTextReason": null, "recommended": "A", "recommendedReason": "1-2 sentence rationale citing a plan.md section, a measurement, or a test result" } ] }\n' +
  '```\n\n' +
  '- One issue = one `questions[]` entry. Give each question **2-4 `options`**, with a `key` unique within that question.\n' +
  '- Use `freeTextRequired: true` ONLY when the answer genuinely cannot be expressed as options (secrets/variable input like an API key or file path); state why in `freeTextReason` (one line). Every other issue MUST be expressed as options.\n' +
  '- `consequence` is a one-line description of the impact of choosing that option.\n' +
  '- **`recommended` and `recommendedReason` are REQUIRED.** Put the `key` of the option you yourself would pick in `recommended`. State the rationale in `recommendedReason` (1-2 sentences) — cite a specific plan.md section, a measurement, or a test result, not a generic claim like "it is lower risk". If you truly cannot judge, do not leave it blank — set `freeTextRequired: true` and explain why in `freeTextReason` instead.\n' +
  "- Set `mutatesGate: true` on any option that would change a gate's verification condition or threshold. Such an option is excluded from unattended auto-answer on timeout even when recommended, and always waits for a human.\n" +
  '- **Set `requiresOperatorAction: true` on any option that cannot proceed until a HUMAN does something outside the workflow** — adding a dependency at the repo root, merging another task\'s PR, provisioning a credential. Such an option is never auto-adopted even when recommended (adopting it would resume you against work nobody did), and the question is counted on the "waiting on a human" axis instead of against your question budget. Measured on #1215: "merge #1214, then resume" was auto-adopted on the 15-minute timeout, nobody merged it, and the next verify bounced at 0/3 acceptance criteria.\n' +
  '- **Set `planRevision: true` only for options that change a completion criterion or replace the approved approach.** Use `planImpact` with `criteria`, `approach`, or `none` to state the impact.\n' +
  '  - Set it for changing a completion criterion to static verification (`"planImpact": "criteria"`) or replacing approach A with approach B across the plan (`"planImpact": "approach"`).\n' +
  '  - Do NOT set it for choosing how to prepare test data within the approved approach or reporting that an issue was fixed in another PR. Use `"planImpact": "none"` when the answer allows implementation to continue within the plan. The implementer resumes with the answer.\n' +
  '  - Also omit the flag when requesting permission to change files outside the plan, including protected paths. For a regression test that needs a file change, use `"planImpact": "none", "grantsFiles": ["src/example.ts"]` and explain the reason in `consequence`. Signed operator approval of the named files is required to prevent self-approval.\n' +
  '- A human answer can use `resumeImplementer: true` to continue under the approved plan for legacy options marked only with the old revision flag. Explicit changes to completion criteria or the approved approach require revision. The override does not apply to gate changes.\n' +
  '- Include AT MOST ONE block (if multiple are present, the UI uses only the first).\n' +
  '- An optional `kind` may be set at the SAME level as `questions` (top level). When raising a question from the plan phase, set either `"kind": "execution_continuation"` (a check needed to continue implementation) or `"kind": "completion_confirmation"` (a final check right before completion). `"kind": "spec_change"` is reserved for intake (before research starts) and is ignored outside that phase.';
