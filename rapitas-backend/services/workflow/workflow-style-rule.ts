/**
 * Workflow Style Rule
 *
 * Shared emoji-free, report-register style rules appended to every workflow
 * role's prompt context (researcher/planner/reviewer/implementer/verifier).
 * Machine-first: the unambiguous parseable skeleton comes first, human-friendly
 * presentation (figure-first sections, eye-flow) is layered on top of it.
 * Not responsible for the verdict-marker vocabulary itself — the machine-parsed
 * markers (✅ 検証成功 / ❌ 検証失敗 / ⚠️ 一部失敗, ✅ Pass / ❌ Fail / ⚠️ Partial)
 * are defined in the role instructions and MUST stay byte-identical there.
 */

/**
 * Style rules appended once per role prompt, keyed by output language.
 * Kept separate from the role instruction texts so those stay untouched.
 */
export const REPORT_STYLE_RULE = {
  ja:
    '## 文体ルール（全成果物共通）\n' +
    '### 最優先: 正確性と機械可読性\n' +
    '- 正確性と機械可読性が最優先。下流のエージェント（planner/implementer/verifier/批評ゲート）がこの文書を解析して次の判断を行うため、曖昧さのない構造を最初に保証し、その上で人間の読みやすさを加える。AI可読とヒト可読が両立しない場合はAI可読を優先する。\n' +
    '- 既定のセクション見出し（`## 検証結果サマリ` 等、機械解析対象）は改名・省略しない。チェックリストは `- ✅ <項目>` / `- ❌ <項目>` の形式を維持する。表の列構成は指示された列名を使い、独自の列名に言い換えない。\n' +
    '- 図（mermaid）は理解補助であり、唯一の情報源にしてはならない。図に含まれる事実（対象ファイル、依存関係、手順、判定）は必ず表または箇条書きとしても本文に存在させること — 下流エージェントはテキスト/表を正として解析する。図と表が矛盾する場合は表が正。\n' +
    '### 表現ルール\n' +
    '- 文書は専門家の分析レポートの文体で書く。絵文字は使用禁止。ただし verify.md の判定マーカー（✅/❌/⚠️）のみ従来通り使用する（機械判定用）。見出し・表・箇条書きで構造化し、装飾記号に頼らない。\n' +
    '- マーカーの意味を言葉で重複させない: チェックリストは「✅ <項目名>」であり「✅ 完了: <項目名>」とは書かない。\n' +
    '- plan.md の本文を verify.md に再掲しない（項目名＋判定のみ）。列挙できる事実は表にする。\n' +
    '- 1セクションの目安: 概要3行以内、各セクション10行以内（テスト失敗の詳細ログのみ例外）。\n' +
    '- 定量データ（件数、実行時間、pass/fail数、カバレッジ%など）を必ず根拠として添え、形容詞だけの評価（「問題ない」「良好」）をしない。\n' +
    '- 比較・列挙・チェック結果は必ず表形式。プロセスや依存関係の説明は番号付きステップまたは階層リスト。\n' +
    '- 表は列を最小限（2〜4列）にし、セル内は簡潔に（長文をセルに入れない）— レビュー画面は横スクロールなしで全列が見える必要がある。\n' +
    '- 変更ファイルの報告は表形式で、列は「ファイル | 種別（新規/変更） | 変更内容の要約（1行、何をなぜ変えたか）」。**行数・差分数値（+N/-N）は記載しない** — 数値からは何を変更したか読み取れない。\n' +
    '- 負例（書いてはならない形）: `| +追加 | -削除 |` 列、`(+120/-45)`、`行数: +N`、`✏️`/`⏭️`/`🆕` などの絵文字ステータス列挙。\n' +
    '- verify.md の全体判定は、冒頭サマリと表の「全体判定」セルの両方で `✅ 検証成功` / `❌ 検証失敗` / `⚠️ 一部失敗` をこの表記のまま使用する。「合格」「条件付き合格」「不合格」等への言い換えは禁止（機械判定はこの語彙のみを認識する）。\n' +
    '- 指示語（「上記」「前述」「これ」）で他セクションを参照しない。参照は見出し名を明記する（例: 「§設計判断の根拠 の通り」）。先行フェーズ文書からの再掲は要点1〜2行のみとし、原文の段落コピーは禁止。\n' +
    '- 用語やファイル名を装飾目的の引用符 `"..."` で囲まない（コード・識別子はバッククォート、それ以外は裸のテキスト）。\n' +
    '### 人間向けの提示（機械可読構造を守った上で適用）\n' +
    '- 図表ファースト: 各セクションはまず図または表で示し、文章はその図表の説明として2〜4文で添える。文章だけの段落を連ねない（上記のとおり、図の事実は表/箇条書きにも必ず残す）。\n' +
    '- Mermaid記法（```mermaid フェンス）はUIで描画される。依存関係・処理フロー・変更前後の構造は flowchart、時系列・フェーズは sequenceDiagram または番号付きステップ、割合・分類は表。凝った図より単純で正しい図（ノード10個以内目安）。\n' +
    '- 眼線誘導: 冒頭=判定マーカー＋3行要約 → 各セクション=図表→説明文 の順を守り、重要な結論を段落の先頭文に置く（結論先行）。',
  en:
    '## Style rules (all artifacts)\n' +
    '### Top priority: accuracy and machine readability\n' +
    '- Accuracy and machine readability come first. Downstream agents (planner/implementer/verifier/critic gates) parse this document to make their next decision — guarantee an unambiguous structure first, then add human readability on top. When AI-comprehensible and human-comprehensible formats conflict, prioritize AI comprehension.\n' +
    '- Never rename or omit the prescribed section headings (`## 検証結果サマリ` etc. — machine-parsed). Keep checklists in the `- ✅ <item>` / `- ❌ <item>` form. Use the instructed table column names; do not invent your own.\n' +
    '- Diagrams (mermaid) are comprehension aids, never the sole carrier of information. Every fact a diagram shows (files touched, dependencies, steps, verdicts) MUST also exist as a table or bullet list in the body — downstream agents parse the text/tables as the source of truth. If a diagram and a table disagree, the table wins.\n' +
    '### Register rules\n' +
    '- Write every document in the register of a professional analysis report. Emoji are forbidden, with one exception: the verify.md verdict markers (✅/❌/⚠️) keep their existing vocabulary (machine-parsed). Structure with headings, tables, and bullet lists instead of decorative symbols.\n' +
    '- Do not restate a marker\'s meaning in words: a checklist item is "✅ <item>", never "✅ Done: <item>".\n' +
    '- Do not re-quote plan.md content in verify.md (item name + verdict only). Put enumerable facts in tables.\n' +
    '- Section size guide: overview ≤ 3 lines, each section ≤ 10 lines (failing-test logs are the only exception).\n' +
    '- Always back statements with quantitative data (counts, run time, pass/fail numbers, coverage %); never give adjective-only judgements ("fine", "looks good").\n' +
    '- Comparisons, enumerations, and check results MUST be tables. Explain processes or dependencies as numbered steps or nested lists.\n' +
    '- Keep tables to few columns (2-4) with terse cells (no long prose in a cell) — the review screen must show every column without horizontal scrolling.\n' +
    '- Report changed files as a table with columns "File | Kind (new/modified) | What changed & why (one line)". **Do NOT include line counts or diff deltas (+N/-N)** — numbers do not convey what was modified.\n' +
    '- Negative examples (never write these): `| +追加 | -削除 |` columns, `(+120/-45)`, `lines: +N`, or emoji status columns such as ✏️/⏭️/🆕.\n' +
    '- The verify.md overall verdict MUST use the canonical phrases verbatim in BOTH the opening summary and the overall-verdict table cell: `✅ 検証成功` / `❌ 検証失敗` / `⚠️ 一部失敗` (en: `✅ Pass` / `❌ Fail` / `⚠️ Partial`). Paraphrases like 合格 / 条件付き合格 / "passed with conditions" are forbidden — the machine gates only recognize this vocabulary.\n' +
    '- Never reference other sections with deictic words (「上記」「前述」, "the above"). Name the heading explicitly (e.g. as per §設計判断の根拠). When restating an earlier phase document, restate only 1-2 key lines — never copy paragraphs verbatim.\n' +
    '- Do not wrap terms or file names in decorative quotation marks `"..."` (backticks for code/identifiers, bare text otherwise).\n' +
    '### Human-facing presentation (applied on top of the machine-readable skeleton)\n' +
    '- Figure-first: open every section with a diagram or table, then add 2-4 sentences of prose as its caption/explanation. Do not stack prose-only paragraphs (per the rule above, diagram facts must also survive as tables/bullets).\n' +
    '- Mermaid fences (```mermaid) are rendered by the UI — use flowchart for dependencies/process flows/before-after structure, sequenceDiagram or numbered steps for timelines/phases, and tables for proportions/classifications. Prefer a simple, correct diagram (≤ ~10 nodes) over an elaborate one.\n' +
    '- Eye-flow: verdict marker + ≤3-line summary first, then per section diagram/table followed by its explanation; put the key conclusion in the first sentence of each paragraph.',
} as const;
