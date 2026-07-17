/**
 * Workflow Style Rule
 *
 * Shared emoji-free, report-register style rules appended to every workflow
 * role's prompt context (researcher/planner/reviewer/implementer/verifier).
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
    '- 文書は専門家の分析レポートの文体で書く。絵文字は使用禁止。ただし verify.md の判定マーカー（✅/❌/⚠️）のみ従来通り使用する（機械判定用）。見出し・表・箇条書きで構造化し、装飾記号に頼らない。\n' +
    '- マーカーの意味を言葉で重複させない: チェックリストは「✅ <項目名>」であり「✅ 完了: <項目名>」とは書かない。\n' +
    '- 冒頭に判定と要点（3行以内）のサマリを置き、詳細はその後のセクションへ。\n' +
    '- plan.md の本文を verify.md に再掲しない（項目名＋判定のみ）。列挙できる事実は表にする。\n' +
    '- 1セクションの目安: 概要3行以内、各セクション10行以内（テスト失敗の詳細ログのみ例外）。\n' +
    '- 文書は見出しで構造化し、可能な限り表で示す。定量データ（件数、実行時間、pass/fail数、カバレッジ%など）を必ず根拠として添え、形容詞だけの評価（「問題ない」「良好」）をしない。\n' +
    '- 比較・列挙・チェック結果は必ず表形式。プロセスや依存関係の説明は番号付きステップまたは階層リスト。\n' +
    '- 表は列を最小限（2〜4列）にし、セル内は簡潔に（長文をセルに入れない）— レビュー画面は横スクロールなしで全列が見える必要がある。\n' +
    '- 変更ファイルの報告は表形式で、列は「ファイル | 種別（新規/変更） | 変更内容の要約（1行、何をなぜ変えたか）」。**行数・差分数値（+N/-N）は記載しない** — 数値からは何を変更したか読み取れない。',
  en:
    '## Style rules (all artifacts)\n' +
    '- Write every document in the register of a professional analysis report. Emoji are forbidden, with one exception: the verify.md verdict markers (✅/❌/⚠️) keep their existing vocabulary (machine-parsed). Structure with headings, tables, and bullet lists instead of decorative symbols.\n' +
    '- Do not restate a marker\'s meaning in words: a checklist item is "✅ <item>", never "✅ Done: <item>".\n' +
    '- Open with the verdict plus a summary of at most 3 lines; details go in the sections that follow.\n' +
    '- Do not re-quote plan.md content in verify.md (item name + verdict only). Put enumerable facts in tables.\n' +
    '- Section size guide: overview ≤ 3 lines, each section ≤ 10 lines (failing-test logs are the only exception).\n' +
    '- Structure with headings and prefer tables. Always back statements with quantitative data (counts, run time, pass/fail numbers, coverage %); never give adjective-only judgements ("fine", "looks good").\n' +
    '- Comparisons, enumerations, and check results MUST be tables. Explain processes or dependencies as numbered steps or nested lists.\n' +
    '- Keep tables to few columns (2-4) with terse cells (no long prose in a cell) — the review screen must show every column without horizontal scrolling.\n' +
    '- Report changed files as a table with columns "File | Kind (new/modified) | What changed & why (one line)". **Do NOT include line counts or diff deltas (+N/-N)** — numbers do not convey what was modified.',
} as const;
