# ICON POLICY — Established meanings (a-f)

Part of `.claude/ICON_POLICY.md` §3 (ESTABLISHED MEANINGS), split alphabetically by glyph name to avoid every new icon addition editing the same file (see task #675). Read `.claude/ICON_POLICY.md` first for the decision tree and how-to-check steps; this file is the reference table only.

| Glyph (lucide)            | Meaning                                  |
| ------------------------- | ---------------------------------------- |
| `Beaker`                  | 仮説台帳 / 仮説 (hypothesis ledger)      |
| `Bug`                     | 懸念バックログ / 懸念の種別「バグ」      |
| `Feather`                 | 複雑度「軽量」                           |
| `FlaskConical`            | ワークフローの「検証」フェーズ           |
| `CopyCheck`               | 一括選択モード（複数タスク/サブタスクの一括操作。旧 `ListChecks` — `ListTodo`＝サブタスクと視覚的に紛らわしいため 2026-07 に移行） |
| `CheckCircle2`            | 完了したワークフロータブ                 |
| `FolderOpen`              | 汎用フォルダ（ディレクトリ選択・ログ等） |
| `CalendarRange`           | スケジュールグループ (nav: habitsAchievements umbrella) |
| `Folders`                 | カテゴリ一覧ページヘッダー               |
| `BarChart2`               | 知識の成長トレンドチャートヘッダー       |
| `Footprints`              | エピソード記憶 (agents/memory OverviewCards) |
| `AlignLeft`               | サブタスク説明の展開/折りたたみトグル（タスク詳細のサブタスク行） |
| `CircleCheckBig`          | 一括選択モードの「すべて選択」（全解除時は汎用 `X`。タスク一覧 HomeToolbar とサブタスクヘッダー共通） |
| `Archive`                 | メモリ管理 / KB管理（検証・忘却アーカイブのライフサイクル管理。nav: /knowledge/admin） |
| `Columns2`                | 画面分割表示への切替（ノートモーダルの分割タブ、統合ターミナルのsplit表示切替、タスク詳細スライドパネルの分割表示トグル — 「サイドバイサイド分割」という共通概念の再利用） |
| `ArrowLeftRight`          | 左右の位置を入れ替える操作（ノート分割のノート/AI入れ替え、統合ターミナルとタスク詳細スライドパネルのドック位置(左右)入れ替え） |
| `AppWindow`               | ライブプレビュー概念全般（タスク詳細のライブプレビューセクション見出し、および `SystemStatusPanel` の起動中プレビュー数タイル — 同一概念の正当な再利用） |
| `ChartNoAxesCombined`     | 自己成長台帳ダッシュボード（nav: /agents/growth。ページ見出し・5指標カードの共通アイコン — 同一ページ内の同一概念として再利用） |
| `ChartScatter`            | 効率フロンティア（ワークフロー実行パラメータの多目標パレート最適化ダッシュボード。nav: /agents/pareto、ページ見出し・空状態 — 同一概念の再利用。注: `ChartNoAxesCombined`＝成長台帳とは別概念） |
| `CalendarSearch`          | カレンダー空き枠スケジューラ（Google カレンダーの空き時間連動の自動実行ゲート。/agents/calendar-slots ページ見出し。注: `CalendarClock`＝バックログ定期ジョブ設定、`CalendarRange`＝スケジュールグループとは別概念） |
| `Bookmark` / `BookmarkPlus` | アプリ内ブラウザのお気に入り（`LinkFavourites` の見出し・パネルを開くボタン、`LinkViewPane` の保存ボタン。`BookmarkPlus`=未保存、`Bookmark`(fill)=保存済み）。注: `Star`＝カテゴリの既定/推奨は別概念のため流用しない。`rapitas-frontend/src/components/category/icons`・`claude-md-generator` のアイコン登録は中立的な再掲で対象外 |
| `FolderPlus`              | アプリ内ブラウザのグループを作る（`LinkFavourites` のグループ追加欄、`TabStripTab` の「新しいグループに追加」— 同一概念の再利用）。注: `FolderOpen`＝汎用フォルダ、`Folders`＝カテゴリ一覧ページヘッダーとは別概念 |
| `Eraser`                  | ラピの「片付ける」モード（ラピの会話の振り分け注記のグリフ — 完了済みタスクの一括整理。注: `Trash2`＝個別削除、`Archive`＝メモリ/KB管理とは別概念。`rapitas-frontend/src/components/category/icons` の登録は中立的な再掲で対象外） |
| `Compass`                 | アプリ内ブラウザ（ヘッダー右上の「ブラウザ」ボタン `HeaderToolbar` → `/browser`。`Globe`＝スコープ「グローバル」、`AppWindow`＝ライブプレビューに割り当て済みのため別グリフ）。注: `SmartCommandBar` のヒント「ページ移動」と `category/icons`・`claude-md-generator` のアイコン登録は既存の中立的な再掲で、本タスクでは変更しない |
| `CircleHelp` (`HelpCircle`) | 入力欄の説明を見る（`HelpTip` — ラベル横の小さな ? で、ホバー・フォーカス・タップで説明を出す。仕様の入力欄の成果物・完了条件・範囲と前提・先に終わらせるタスクで使用。ユーザー指定のグリフ）。注: 同じグリフはワークフローの「質問・回答待ち」（`WorkflowQuestionPanel`・`WorkflowTabBar`・`WorkflowStatusIndicator`・通知トースト）と判定不明（`JudgeEvalCard`・仮説の inconclusive）でも使われている。これらはステータス・バッジの文脈、こちらはラベル横の操作ボタンの文脈で、見た目の位置が分かれる |
| `Combine`                 | ラピの「アイデアを整理」（似たアイデアをまとめる・不要なアイデアを片付ける。`rapi-modes.ts` の ideaTidy。注: `Eraser`＝タスクの片付け、`Lightbulb`＝アイデアそのものとは別概念） |
| `Cookie`                  | アプリ内ブラウザの「閲覧データを消去」（`BrowserToolbar` の「…」、設定「リンクの開き方」下の `BrowsingDataRow`）。注: `Eraser`＝ラピの「片付ける」モード、`Trash2`＝個別削除とは別概念。`rapitas-frontend/src/components/category/icons` の登録は中立的な再掲で対象外 |
| `CirclePause`             | 節目の休止（ゴール詳細の節目カードの「休止する」— 休止は正当な判断で、到達率の分母から外れる。注: `Pause`＝ポモドーロ/フォーカスの一時停止とは別概念） |
| `ClipboardList`           | タスクの仕様（タスク詳細の「タスクの仕様」セクション `TaskSpecEditSection` — ゴール・範囲外・制約・成果物、#1555。注: `ListChecks`＝提案タスクの完了条件バレット、`ListTodo`＝サブタスクとは別概念。`claude-md-generator` の `wizard-icons` の登録は中立的な再掲で対象外） |
| `ChevronDown`             | 下に続きがある・下へ（ドロップダウンを開く汎用の慣用に加え、チャットの末尾ジャンプ `JumpToLatestButton` — ラピの会話と相談チャットで最下部から離れたときに右下へ浮かぶ半透明の丸ボタン。モバイルは `Icons.keyboard_arrow_down`。「下にあるものへ」という同じ慣用の再利用として登録） |
| `Copy` / `Check`          | ラピの文章の返答をクリップボードへコピー（相談チャット `CopyReplyButton` — 返答の右上の小さなアイコン。コピー直後だけ `Check` に変わる。モバイルは `Icons.copy_rounded` / `Icons.check`。ノートのチャット `chat-message` のコードブロックの「Copy」→「Copied!」と同じ「コピーする／した」慣用の再利用として登録。注: `CopyCheck`＝一括選択モードとは別概念） |
