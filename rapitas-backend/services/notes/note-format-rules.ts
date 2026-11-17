/**
 * note-format-rules
 *
 * The one definition of how a note body is written: Markdown limited to what
 * the desktop (MarkdownView, note density) and the phone (NoteContentMarkdown,
 * flutter_markdown_plus) both render the same way. Prompts that lead to a note
 * body quote these strings instead of restating the rules.
 * Not responsible for checking or rewriting a body — the rules are guidance
 * for the model; the note API stores whatever it is sent.
 *
 * See docs/design/note-markdown-format.md for where the rules are used.
 */

// NOTE: the phone opens only http / https / mailto links and shows Mermaid as
// code ("図は PC で表示されます"); the desktop draws Mermaid. Raw HTML is shown
// as text on the phone, so it is ruled out rather than left to each renderer.
const SHARED_RULES = [
  '- 強調は **太字** を使う',
  '- 箇条書きは「- 」、番号付きの手順は「1. 」で書く',
  '- 表は Markdown の表で書く（1行目が見出し、2行目が | --- |）。セルの中で改行しない',
  '- コードは ``` で囲む。言語名を付けてよい（例: ```ts）',
  '- リンクは [文言](https://...) の形で、http または https の URL にする',
  '- 引用は行頭に「> 」を付ける',
  '- 図は ```mermaid のコードブロックで書く（PC では図として描かれ、スマホではコードのまま表示される）',
  '- 生の HTML（<br>・<div>・<span> など）は使わない。改行は空行か箇条書きで表す',
  '- 特定の画面でしか効かない書き方（脚注、数式、色や文字サイズの指定、絵文字のショートコード）は使わない',
];

/** Rules for a note body written as a whole. / ノート本文全体を書くときの書式 */
export const NOTE_MARKDOWN_FORMAT_RULES = [
  'ノートの書式（PC とスマホの両方で同じように表示される Markdown の範囲で書く）:',
  '- 見出しは ## と ### を使う（# は使わない。ノートのタイトルは別に付く）',
  ...SHARED_RULES,
].join('\n');

/**
 * Rules for a chat reply, which can be saved as a note as-is. The saved note
 * wraps it as "## 質問" / "## ラピの回答" (copilot-note.ts on the desktop,
 * rapi_reply_note.dart on the phone), so the reply's own headings start one
 * level down to sit under "## ラピの回答".
 */
export const NOTE_REPLY_FORMAT_RULES = [
  '返答の書式（返答はそのままノートに保存されることがある。PC とスマホの両方で同じように表示される Markdown の範囲で書く）:',
  '- 見出しが要るときは ### と #### を使う（保存時に「## ラピの回答」の下に入るため。# と ## は使わない）',
  '- 短い返答に見出しや表は付けない。必要なときだけ使う',
  ...SHARED_RULES,
].join('\n');

/**
 * Rule for short fields that code places into a note (list items, table
 * cells) — the note's Markdown is built around them, so they carry none.
 */
export const NOTE_FIELD_TEXT_RULE =
  '- これらの項目はそのままノートの箇条書きや表に入る。1項目は1行の素の文章で書き、見出し・箇条書きの記号・表の | ・HTML を含めない。';
