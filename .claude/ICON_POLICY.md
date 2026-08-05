# ICON CONSISTENCY POLICY

## PRIME DIRECTIVE

One icon = one meaning, app-wide.

- **Same meaning → reuse the same icon.** Consistency aids recognition.
- **Different meaning → use a different icon.** Never reuse an icon that already
  stands for another concept; doing so hurts scannability and breaks the user's
  intuitive "this glyph means X" mental model.

A glyph is part of the UI's vocabulary. Two unrelated meanings sharing one glyph
is as confusing as two unrelated functions sharing one name.

---

## 1. DECISION TREE — Before adding an icon

```
What concept does this icon represent here?
├── Is that concept already shown with an icon elsewhere?
│     └── YES → reuse THAT icon (same meaning → same glyph).
└── Is the glyph I want to use already used for a DIFFERENT concept?
      ├── YES → pick a different glyph (different meaning → different icon).
      └── NO  → OK to use it; it now "owns" this meaning.
```

---

## 2. HOW TO CHECK (do this every time)

1. **Search the glyph** you intend to use — is it already imported anywhere for
   a different purpose?
   `grep -rn "Bug" src --include=*.tsx`
2. **Search the concept** — does an icon already represent it? Reuse that one.
3. When unsure, prefer a distinct, conventional glyph over an overloaded one.

---

## 3. ESTABLISHED MEANINGS (living reference — extend as you add)

Keep this list accurate. If you assign a glyph a new meaning, add it here.

| Glyph (lucide)            | Meaning                                  |
| ------------------------- | ---------------------------------------- |
| `Lightbulb`               | アイデア (idea box / an idea) — 許可パスは `/ideas` に加え、同一概念の正当な再利用として `IdeaBoxPanel`（ホームのアイデアボックス起動ウィジェット）、`memo-section`（メモ種別「アイデア」バッジ）、`category/icons`（アイコンピッカー登録）、`header/header.tsx`（/ideas へのnavリンク）、`quick-capture`（グローバルショートカットのアイデア即時投入ポップアップ）を明示許可（`eslint-rules/icon-policy-map.mjs`） |
| `Beaker`                  | 仮説台帳 / 仮説 (hypothesis ledger)      |
| `Inbox`                   | 「バックログ」ナビ群                     |
| `Bug`                     | 懸念バックログ / 懸念の種別「バグ」      |
| `Wrench`                  | 懸念の種別「リファクタ」                 |
| `ShieldAlert`             | 懸念の種別「セキュリティ」               |
| `Feather`                 | 複雑度「軽量」                           |
| `Layers`                  | 複雑度「詳細」                           |
| `FlaskConical`            | ワークフローの「検証」フェーズ           |
| `ListTodo`                | サブタスク                               |
| `ListPlus`                | タスク作成 / タスク起票 (task_created、quick-capture のタスクモードタブ — 同一概念の再利用) |
| `CopyCheck`               | 一括選択モード（複数タスク/サブタスクの一括操作。旧 `ListChecks` — `ListTodo`＝サブタスクと視覚的に紛らわしいため 2026-07 に移行） |
| `ListChecks`              | 提案タスクの完了条件バレット（`TaskSuggestionDetail`） |
| `CheckCircle2`            | 完了したワークフロータブ                 |
| `PriorityIcon` (chevrons) | タスク/アイデアの優先度                  |
| `Globe`                   | スコープ「グローバル」                   |
| `FolderOpen`              | 汎用フォルダ（ディレクトリ選択・ログ等） |
| `LayoutDashboard`         | ダッシュボード (nav: /dashboard)         |
| `CalendarRange`           | スケジュールグループ (nav: habitsAchievements umbrella) |
| `LayoutList`              | タスク分類グループ (nav: category/theme/label umbrella) |
| `Folders`                 | カテゴリ一覧ページヘッダー               |
| `Scale`                   | 意思決定 / デシジョンジャーナル          |
| `SquareTerminal`          | 統合ターミナル                           |
| `SplitSquareHorizontal`   | ターミナルのペイン左右分割               |
| `SplitSquareVertical`     | ターミナルのペイン上下分割               |
| `Server`                  | バックエンドサーバー本体の状態 (BackendConnectionError, agents SystemStatusPanel status pill) |
| `PlayCircle`              | いま実際に実行中のエージェント数 (SystemStatusPanel activeExecutions) |
| `Layers3`                 | 自動実行キューの積み上げ件数 (SystemStatusPanel queueDepth) |
| `Sprout`                  | 記憶の成長 (nav: /agents/memory)         |
| `Library`                 | 知識ベース (nav: /knowledge グループ; 知識関連の通知・サジェストパネルでの再利用も可) |
| `Search`                  | 知識ブラウザ (nav: /knowledge)           |
| `BarChart2`               | 知識の成長トレンドチャートヘッダー       |
| `Signal`                  | 記憶強度 (MemoryStrengthCard)            |
| `Footprints`              | エピソード記憶 (agents/memory OverviewCards) |
| `Info`                    | ヒント/提案バレット（AI分析・プロンプト最適化・学習プラン等の提案リスト先頭アイコン。`Lightbulb`＝アイデアと混同しないこと） |
| `Sparkles`                | AI生成/おすすめ操作（分析実行・プロンプト最適化・イノベーションジョブ種別など、AIが生成/提案する操作全般） |
| `Gauge`                   | 懸念の種別「パフォーマンス」（旧・複雑度「標準」との衝突は解消済み — 下記 Known collisions 参照） |
| `Gavel`                   | 敵対的レビュー判定（adversarial diff-review judge eval）カードタイトル |
| `AlignLeft`               | サブタスク説明の展開/折りたたみトグル（タスク詳細のサブタスク行） |
| `CircleCheckBig`          | 一括選択モードの「すべて選択」（全解除時は汎用 `X`。タスク一覧 HomeToolbar とサブタスクヘッダー共通） |
| `LayoutTemplate`          | テンプレート設定（タスク詳細メニュー。テンプレート実体は `FileStack`） |
| `Settings`                | 設定を開く操作全般（設定ハブnavに加え、`TaskPreviewSection` のプレビュー設定モーダルを開くボタンでの再利用をユーザー承認済み — 同一概念「設定を開く」の正当な拡張。旧・エージェント管理/メモリ管理との3重使用は 2026-07-17 に解消） |
| `UserCog`                 | エージェント管理 (nav: /agents)          |
| `Archive`                 | メモリ管理 / KB管理（検証・忘却アーカイブのライフサイクル管理。nav: /knowledge/admin） |
| `GitBranch`               | タスク詳細の「ワークフロー」セクション（`TaskWorkflowSection` カードヘッダー + quick-nav `td-workflow`。注: 同一glyphは実際のGitブランチ名フィールド/ピッカー(テーマ設定・ディレクトリピッカー等)でも多用されており、そちらは別の慣用（ブランチそのもの）として許容 — カード見出し文脈とフィールド文脈は視覚的に紛れないため） |
| `PanelBottom`             | 統合ターミナルを下部パネル表示（overlay）に戻す操作（TerminalTabBar。split表示への切替は `Columns2`） |
| `Columns2`                | 画面分割表示への切替（ノートモーダルの分割タブ、統合ターミナルのsplit表示切替、タスク詳細スライドパネルの分割表示トグル — 「サイドバイサイド分割」という共通概念の再利用） |
| `ArrowLeftRight`          | 左右の位置を入れ替える操作（ノート分割のノート/AI入れ替え、統合ターミナルとタスク詳細スライドパネルのドック位置(左右)入れ替え） |
| `AppWindow`               | ライブプレビュー概念全般（タスク詳細のライブプレビューセクション見出し、および `SystemStatusPanel` の起動中プレビュー数タイル — 同一概念の正当な再利用） |
| `WalletCards`             | 単語帳 (nav: /vocabulary、単語帳ページヘッダー・空状態、quick-capture の単語モードタブ — 同一概念の再利用) |
| `ChartSpline`             | 単語帳の学習分析 (/vocabulary/analytics ページヘッダー・一覧からのリンクボタン) |
| `BookOpenText`            | 単語カードの辞書情報編集（カード行の編集ボタン・エディタモーダルタイトル） |
| `Equal`                   | 類義語ラベル（単語帳の関係ビジュアル） |
| `ArrowRightLeft`          | 対義語ラベル（単語帳の関係ビジュアル。注: `ArrowLeftRight`＝ドック左右入れ替えとは別グリフ） |
| `Pin` / `PinOff`          | ピン留め＝開いたまま維持（サイドナビの固定、quick-capture のフォーカス喪失時も閉じない — 同一概念の再利用） |
| `Milestone`               | 学習ロードマップ (nav: /learning-roadmap、ページヘッダー・目標フォームモーダル。旧 学習目標=BookMarked / 試験目標=Target は統合により nav から退役) |
| `AlarmClockPlus`          | 学習時間の記録（学習ロードマップの「学習を記録」ボタン・記録モーダル。注: `Timer`＝ポモドーロ/見積時間とは別概念） |
| `NotepadText`             | メモ（軽量メモ機能。nav: /memos、ページヘッダー、quick-capture のメモモードタブ。注: `NotebookTabs`＝ノート、`StickyNote`＝検索結果のノート種別と混同しないこと） |
| `Notebook`                | 「ノート・メモ」ナビグループ（/notes と /memos の親アンブレラ。子の `NotebookTabs`＝ノート・`NotepadText`＝メモとは別グリフ） |
| `AlarmClock`              | メモのリマインダー（quick-capture / /memos のリマインダー行アイコン・一覧のリマインダーバッジ。注: `AlarmClockPlus`＝学習時間の記録とは別概念） |

### Known collisions

_None outstanding._ Both previously-tracked collisions are resolved:

- `Gauge` — 複雑度「標準」 moved to `ArrowRight` (`WorkflowModeSelector`); `Gauge`
  now uniquely means 懸念の種別「パフォーマンス」.
- `ListChecks` — dev-mode `TaskAnalysisPanel`「提案されたサブタスク」 header moved
  to `ListTodo` (the established subtask glyph). 一括選択モード later moved from
  `ListChecks` to `CopyCheck` (2026-07, too similar to `ListTodo`); `ListChecks`
  now uniquely means 提案タスクの完了条件バレット.

---

## 4. ANTI-PATTERNS — Never do these

```tsx
// ❌ Same glyph, two unrelated meanings
<CheckCircle2 />  // here: "completed"
<CheckCircle2 />  // elsewhere: "selected" — pick CheckSquare / Check instead

// ❌ Reaching for a glyph already owned by another concept
<Lightbulb />     // already = "idea"; don't reuse it for "tip/hint/insight"

// ✅ Distinct meanings, distinct glyphs
<Lightbulb />     // idea
<Bug />           // concern / bug
```

---

## QUICK REFERENCE

```
Adding an icon?
  Same meaning as an existing icon?   → reuse that icon
  Glyph already means something else? → choose a different glyph
  New, unused glyph for a new meaning → OK; record it in §3
Never: one glyph for two unrelated meanings.
```
