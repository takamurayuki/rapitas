# ノートの書式

ノートの本文は、PC（デスクトップ）とスマホの両方で同じように表示される Markdown の範囲で書く。ルールの本体は `rapitas-backend/services/notes/note-format-rules.ts` に1か所だけ定義し、ノートの本文につながるプロンプトはそこから文字列を取り込む。この文書は、ルールの範囲と、どの生成経路が取り込んでいるかを示す。

## 表示する側

ノートはサーバに Markdown の文章として保存され、PC とスマホは同じノートを読み書きする。PC のノート画面・サイドバー・タスク詳細のノート表示は `rapitas-frontend/src/stores/note-store.ts` を通して `/notes` の API を読み書きする（第0段階、nav76）。

| 画面                                              | 描画部品                                                                                                    | 図（Mermaid）                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| PC のノート画面（/notes）とタスク詳細のノート表示 | `MarkdownNoteEditor`（`MarkdownView` の `note` 密度。見た目のまま直す「編集」と原文の「ソース」で編集する） | 図として描く                                         |
| スマホのノート詳細                                | `NoteContentMarkdown`（flutter_markdown_plus）                                                              | コードのまま見せ、「図は PC で表示されます」と添える |

> [!IMPORTANT]
> その PC のブラウザにだけあったノート（localStorage の `note-storage`）は、ノート画面の移行の帯からサーバーに移す。移し終えるまで、その PC のノート画面はブラウザのノートを表示する。移した後のブラウザのノートは読み取り専用の控えで、書き換えない。手順と記録（`note-migration`）は `rapitas-frontend/src/components/note/migration/` にある。

## 旧形式（HTML）のノート

以前の PC のリッチエディタで書いたノートは HTML で保存されている。新規作成と編集の保存は Markdown だけで、HTML を新たに保存する経路は無い。

- 判定は `isLegacyEditorHtml` で行う。コードのフェンスとインラインコードを除いた本文に、リッチエディタが書くタグがあるときだけ旧形式とする。空の本文、1行の本文、`&amp;` などの実体参照だけの本文は旧形式ではない。規則はバックエンド（`rapitas-backend/services/notes/note-content-kind.ts`）とフロントエンド（`rapitas-frontend/src/components/note/markdown-note/note-content-kind.ts`）にあり、両方のテストが `note-content-kind.cases.json` の同じ表を読む。
- PC は旧形式のノートを読み取り専用で表示し（`LegacyHtmlNoteView`）、「Markdown に変換して編集」で変換結果を見せてから保存する。変換は `html-to-markdown.ts` の `htmlToMarkdown` が行い、文字色・ハイライト・文字サイズ・下線は §装飾（許可した HTML） の形で残す。フォントと枠線は失われる。
- サーバーは `PUT` / `PATCH /notes/:id` で旧形式の本文を 400（`legacy_html_content`）で拒否する。本文を送らない更新（タイトル・タグ・ピン）は旧形式のノートにも効く。HTML を受けるのは移行用の `POST /notes/import` と `POST /notes/migration/resolve` だけである。
- `note-content-format.ts` の `isMarkdownNoteContent` は一覧の1行表示の振り分けにだけ使い、保存の検証には使わない。
- 判定のタグから `span`、`u`、`mark` は外してある。旧エディタは必ず `div` か `br` を一緒に書くので、旧形式の判定は変わらない。`span` だけの本文は Markdown として開き、許可した形だけを描く。

## 装飾（許可した HTML）

文字色・ハイライト・文字サイズ・下線は Markdown で表せないため、次の4つの形だけを小さな HTML として Markdown に埋め込む。PC の「編集」（WYSIWYG、`rapitas-frontend/src/components/note/markdown-note/wysiwyg/`）のツールバーはこの形で書く。

| 装飾       | 保存する形                                                    |
| ---------- | ------------------------------------------------------------- |
| 文字色     | `<span style="color:#RRGGBB">…</span>`                        |
| ハイライト | `<mark style="background-color:#RRGGBB">…</mark>`             |
| 文字サイズ | `<span style="font-size:NNpx">…</span>`（NN は 8〜72 の整数） |
| 下線       | `<u>…</u>`                                                    |

- 色は6桁の `#RRGGBB` だけを許し、保存では大文字にそろえる。3桁、色名、`rgb()`、`url()` は許さない。
- `style` は1つのプロパティだけを持つ。重ねるときは入れ子にし、外側から文字サイズ、文字色、ハイライト、下線の順にする。スマホの解析がこの順を前提にする。
- Markdown の記号は HTML の内側に置く（`<span style="color:#E53935">**太字**</span>`）。外側に置くと、日本語の隣で強調にならない。

### 保存時の除去

保存時に、許可した形以外の HTML を取り除く。規則は `sanitizeNoteInlineHtml` で、バックエンド（`rapitas-backend/services/notes/inline-html/`）とフロントエンド（`rapitas-frontend/src/components/note/markdown-note/inline-html/`）にあり、両方のテストが `note-inline-html.cases.json` の同じ表を読む。

| 入力                                                                                 | 処理                                                           |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| フェンスとインラインコードの中                                                       | 触らない                                                       |
| 同じ段落で対になる許可した形                                                         | 正規形にして残す                                               |
| 許可していない `span` / `mark` / `u`（`onclick`、別のプロパティ、外部 URL の色など） | タグだけ除き、文字は残す                                       |
| `script`、`style`、`iframe` など                                                     | 終了タグまで中身ごと除く。終了タグが無いときは開始タグだけ除く |
| コメント、`<!DOCTYPE`、その他のタグ、対にならないタグ                                | 除く                                                           |
| `a < b`、`<https://…>`                                                               | 触らない                                                       |

- 旧形式の判定が先に走る。`div`、`p`、`br` などを含む本文は、除去せずに 400（`legacy_html_content`）で拒否する。
- 除去をかける経路は `saveNote`（`PUT` / `PATCH`）、`POST /notes/batch`、成果物ノートの作成の3つである。移行用の取り込みにはかけない。
- PC はローカル保存でも同じ除去をかけてから保存する（`prepareNewMarkdownContent`）。除去は2回かけても結果が変わらない。

### 装飾の表示

- PC は `note` 密度の `MarkdownView` で描く。remark プラグイン（`remark-note-inline-html.ts`）が、対になった許可した形だけを要素にする。`rehype-raw` は使わず、それ以外の HTML は今までどおり文字として出る。他の密度は HTML を描かない。
- スマホは `rapitas-mobile/lib/widgets/markdown/note_inline_html.dart` が正規形だけを解析して描く。スマホの編集画面は本文をそのまま送るので、許可した形は編集しても消えない。

### 対象外の装飾

| 装飾                                     | 扱い                                      | 理由                                                                               |
| ---------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| フォントの種類                           | 保存しない                                | Markdown で共有できないため。必要なら別タスクで扱う                                |
| 枠線（縦線）                             | 保存しない                                | Markdown で共有できないため                                                        |
| リンクカード                             | 通常のリンク `[文言](URL)` として保存する | Markdown にカードの表現が無いため                                                  |
| ハイライトのスタイル（下側マーカーなど） | 単色に統一する                            | 許可した形が単色の `background-color` だけで、スマホでグラデーションを描けないため |

> [!NOTE]
> PC の「編集」は、開いただけでは本文を書き換えない。書き出すと表記が変わる本文（`*` の箇条書きなど）では注意を出すので、元の書き方を保つときは「ソース」で編集する。

## 使ってよい書き方

| 要素     | 書き方                                                             |
| -------- | ------------------------------------------------------------------ |
| 見出し   | `##` と `###`。`#` はタイトルと重なるので使わない                  |
| 強調     | `**太字**`                                                         |
| 箇条書き | 行頭に `-` と空白、番号付きは `1.` と空白                          |
| 表       | Markdown の表。セルの中で改行しない                                |
| コード   | ` ``` ` で囲む。言語名を付けてよい                                 |
| リンク   | `[文言](https://...)`。スマホは http・https・mailto 以外を開かない |
| 引用     | 行頭に `>` と空白                                                  |
| 図       | ` ```mermaid ` のコードブロック                                    |

使わないもの:

- 生の HTML（`<br>`、`<div>` など）。スマホでは文字として出る。
- 特定の画面でしか効かない書き方（脚注、数式、色や文字サイズの指定、絵文字のショートコード）。

## ルールの種類

| 定数                         | 使う場面                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `NOTE_MARKDOWN_FORMAT_RULES` | ノートの本文を丸ごと書かせるとき                                                      |
| `NOTE_REPLY_FORMAT_RULES`    | チャットの返答。返答の見出しは `###` から始める                                       |
| `NOTE_FIELD_TEXT_RULE`       | コードがノートの箇条書きや表に差し込む短い項目。記号や HTML を含めない1行の文章にする |

> [!NOTE]
> `NOTE_REPLY_FORMAT_RULES` が見出しを `###` から始めるのは、保存したノートで返答が「## ラピの回答」の下に入っていたためである。返答をノートに保存するときは下書き生成（「返答をノートに保存する流れ」の節）が見出しを `##` と `###` に繰り上げるので、この前提はもう無い。返答の見出しはチャット表示にも効くため、ルールの見直しは別のタスクで扱う。

## 取り込んでいる生成経路

| 生成経路                                                                                                     | プロンプト                                                                | 取り込むルール               |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------- |
| ラピのチャット返答（PC のコパイロット、スマホのチャット・相談）。返答はノートに保存できる                    | `rapitas-backend/services/ai/copilot-system-prompts.ts` の2つのプロンプト | `NOTE_REPLY_FORMAT_RULES`    |
| 返答をノートに保存するときの下書き（`POST /notes/draft-from-reply`）。回答だけからタイトルと整えた本文を作る | `rapitas-backend/services/notes/note-draft.ts`                            | `NOTE_MARKDOWN_FORMAT_RULES` |
| ロードマップの締めのノート（前提・比較の軸）                                                                 | `rapitas-backend/services/assistant/roadmap-prompts.ts`                   | `NOTE_FIELD_TEXT_RULE`       |
| 完了したタスクの成果物ノート（`verify.md` / `research.md` から自動で作る）                                   | `rapitas-backend/services/notes/deliverables/deliverable-draft.ts`        | `NOTE_MARKDOWN_FORMAT_RULES` |

ノートの本文を書く新しい生成経路を作るときは、プロンプトに `NOTE_MARKDOWN_FORMAT_RULES` を取り込む。サーバーが自分でノートを書く経路は、成果物ノートの自動作成だけである（下の「成果物ノート」）。

ロードマップの締めのノートは、作成したタスクの一覧とともにサーバーに保存し、作ったタスクすべてに `POST /notes/:id/links` で紐付ける（`rapitas-frontend/src/components/rapi-avatar/intake/roadmap/roadmap-note.ts` の `saveRoadmapNote`）。各タスクの説明の末尾には、同じ id を指す `/rapitas-note/{taskId}/{noteId}` のチップを書き足す。

## 保存の契約

本文・タイトル・タグ・種類を書く経路は、保存した4項目と `Note.version`（4項目を決まった形にした JSON の SHA-256）が常に一致するように書く（`rapitas-backend/services/notes/note-write.ts`）。行を読み、送られた項目を当てた最終値から `version` を計算し、読んだ版を条件にした更新で書く。ほかの書き込みと重なって3回とも条件に合わなければ 409 を返して書かない。

紐付けの `meta` は `taskTitle`・`categoryName`・`themeName`・`projectName`・`parentTaskTitle` の5項目を受ける。PC は `taskTitle`・`themeName`・`categoryName` を、スマホは `themeName`・`projectName`・`parentTaskTitle` を書く。紐付けのリンク先タスクは要求のワークスペースで確かめ、存在しない・別のワークスペースのタスクは 404 になる。

## 置き場所と成果物ノート

ノートの置き場所は `Note.themeId`・`categoryId`・`folderId` の3列だけで決まる（どれか1つ、全部 NULL なら未分類）。木（`GET /notes/tree`）・一覧（`GET /notes`）・詳細（`GET /notes/:id`）の `placement` は、同じ関数 `describePlacement`（`rapitas-backend/services/notes/placement/describe-placement.ts`）で列から導く。読み取りはノートを動かさない。紐付けの `meta` とタイトルは置き場所の判定に使わない。

完了したタスクの `verify.md`（無ければ `research.md`）が、見出しと空行を除いて200字以上あると、成果物ノートを `deliverable-task-{taskId}`（`research-task-{taskId}`）の id で作る（`rapitas-backend/services/notes/deliverables/`）。本文は生成で整え、生成に失敗したら保存しない。同じ id のノートがあれば書き換えない。置き場所は元タスクの有効テーマで、タスクのテーマが変わると追随する（人が動かしたら追随をやめる）。

## 返答をノートに保存する流れ

PC のコパイロット（`SaveToNoteButton.tsx`、`copilot-note.ts`）とスマホのラピ（`rapi_reply_note_provider.dart`、`rapi_reply_note.dart`）は同じ順で保存する。質問文は送らず、ノートにも入れない。

1. `POST /notes/draft-from-reply` に回答だけを送り、タイトルと本文を受け取る。回答が空なら 400、下書きを作れなければ 502 になる。
2. 受け取ったタイトルと本文を `PUT /notes/:id` で保存する。下書きが失敗したときは保存しない（整えていない本文で保存する代わりの経路は無い）。
3. タスクの相談なら `POST /notes/:id/links` でタスクに紐付ける。紐付けの失敗は保存の失敗にしない。

モデルがタイトルを返さなかったときは本文の最初の行を、それも無いときは「ラピとの会話」をタイトルにする。30字を超えるタイトルは切って「…」を付ける。
