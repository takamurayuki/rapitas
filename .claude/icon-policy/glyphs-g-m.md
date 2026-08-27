# ICON POLICY — Established meanings (g-m)

Part of `.claude/ICON_POLICY.md` §3 (ESTABLISHED MEANINGS), split alphabetically by glyph name to avoid every new icon addition editing the same file (see task #675). Read `.claude/ICON_POLICY.md` first for the decision tree and how-to-check steps; this file is the reference table only.

| Glyph (lucide)            | Meaning                                  |
| ------------------------- | ---------------------------------------- |
| `Lightbulb`               | アイデア (idea box / an idea) — 許可パスは `/ideas` に加え、同一概念の正当な再利用として `IdeaBoxPanel`（ホームのアイデアボックス起動ウィジェット）、`memo-section`（メモ種別「アイデア」バッジ）、`category/icons`（アイコンピッカー登録）、`header/header.tsx`（/ideas へのnavリンク）、`quick-capture`（グローバルショートカットのアイデア即時投入ポップアップ）を明示許可（`eslint-rules/icon-policy-map.mjs`） |
| `Inbox`                   | 「バックログ」ナビ群                     |
| `Layers`                  | 複雑度「詳細」                           |
| `ListTodo`                | サブタスク                               |
| `ListPlus`                | タスク作成 / タスク起票 (task_created、quick-capture のタスクモードタブ — 同一概念の再利用) |
| `ListChecks`              | 提案タスクの完了条件バレット（`TaskSuggestionDetail`） |
| `Globe`                   | スコープ「グローバル」                   |
| `LayoutDashboard`         | ダッシュボード (nav: /dashboard)         |
| `LayoutList`              | タスク分類グループ (nav: category/theme/label umbrella) |
| `Layers3`                 | 自動実行キューの積み上げ件数 (SystemStatusPanel queueDepth) |
| `Library`                 | 知識ベース (nav: /knowledge グループ; 知識関連の通知・サジェストパネルでの再利用も可) |
| `Info`                    | ヒント/提案バレット（AI分析・プロンプト最適化・学習プラン等の提案リスト先頭アイコン。`Lightbulb`＝アイデアと混同しないこと） |
| `Gauge`                   | 懸念の種別「パフォーマンス」（旧・複雑度「標準」との衝突は解消済み — 下記 Known collisions 参照） |
| `Gavel`                   | 敵対的レビュー判定（adversarial diff-review judge eval）カードタイトル |
| `LayoutTemplate`          | テンプレート設定（タスク詳細メニュー。テンプレート実体は `FileStack`） |
| `GitBranch`               | タスク詳細の「ワークフロー」セクション（`TaskWorkflowSection` カードヘッダー + quick-nav `td-workflow`。注: 同一glyphは実際のGitブランチ名フィールド/ピッカー(テーマ設定・ディレクトリピッカー等)でも多用されており、そちらは別の慣用（ブランチそのもの）として許容 — カード見出し文脈とフィールド文脈は視覚的に紛れないため） |
| `Milestone`               | 学習ロードマップ (nav: /learning-roadmap、ページヘッダー・目標フォームモーダル。旧 学習目標=BookMarked / 試験目標=Target は統合により nav から退役) |
| `IterationCw`             | 品質ループレビュー（バックログ定期ジョブ loop_review — 差し戻し指標の週次自己観測と停滞の自動起票。カテゴリアイコンピッカー登録は中立的な再掲で対象外） |
| `MonitorCheck`            | 本線 CI 監視（バックログ定期ジョブ ci_watch — 本線ブランチの赤ワークフローを懸念に自動起票） |
| `MessageSquarePlus`      | エージェントへの追加指示（実行完了後の継続指示 `ContinuationForm`/`ExecutionCompletedPanel`、および計画の修正依頼 `PlanRevisionRequest` — いずれも「走っている/走り終えたエージェントに文章で指示を足す」同一概念の再利用） |
| `LifeBuoy`                | リカバリーメトリクス（エージェント実行フォールバックの種別×戦略別 成功率/レイテンシ/コスト集計。`RecoveryMetricsPanel` ヘッダー） |
