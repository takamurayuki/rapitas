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
  '- ブロックは1個のみ保存する（複数あるとUIは最初の1個のみ使用する）。';

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
  '- Include AT MOST ONE block (if multiple are present, the UI uses only the first).';
