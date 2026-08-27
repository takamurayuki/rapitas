# ICON POLICY — Established meanings (n-s)

Part of `.claude/ICON_POLICY.md` §3 (ESTABLISHED MEANINGS), split alphabetically by glyph name to avoid every new icon addition editing the same file (see task #675). Read `.claude/ICON_POLICY.md` first for the decision tree and how-to-check steps; this file is the reference table only.

| Glyph (lucide)            | Meaning                                  |
| ------------------------- | ---------------------------------------- |
| `ShieldAlert`             | 懸念の種別「セキュリティ」               |
| `PriorityIcon` (chevrons) | タスク/アイデアの優先度                  |
| `Scale`                   | 意思決定 / デシジョンジャーナル          |
| `SquareTerminal`          | 統合ターミナル                           |
| `SplitSquareHorizontal`   | ターミナルのペイン左右分割               |
| `SplitSquareVertical`     | ターミナルのペイン上下分割               |
| `Server`                  | バックエンドサーバー本体の状態 (BackendConnectionError, agents SystemStatusPanel status pill) |
| `PlayCircle`              | いま実際に実行中のエージェント数 (SystemStatusPanel activeExecutions) |
| `Sprout`                  | 記憶の成長 (nav: /agents/memory)         |
| `Search`                  | 知識ブラウザ (nav: /knowledge)           |
| `Signal`                  | 記憶強度 (MemoryStrengthCard)            |
| `Sparkles`                | AI生成/おすすめ操作（分析実行・プロンプト最適化・イノベーションジョブ種別など、AIが生成/提案する操作全般） |
| `Percent`                 | エージェント稼働率（役割別・CLI別稼働率チャートカード。`Gauge`＝懸念種別パフォーマンスとは別概念） |
| `Settings`                | 設定を開く操作全般（設定ハブnavに加え、`TaskPreviewSection` のプレビュー設定モーダルを開くボタンでの再利用をユーザー承認済み — 同一概念「設定を開く」の正当な拡張。旧・エージェント管理/メモリ管理との3重使用は 2026-07-17 に解消） |
| `PanelBottom`             | 統合ターミナルを下部パネル表示（overlay）に戻す操作（TerminalTabBar。split表示への切替は `Columns2`） |
| `Pin` / `PinOff`          | ピン留め＝開いたまま維持（サイドナビの固定、quick-capture のフォーカス喪失時も閉じない — 同一概念の再利用） |
| `NotepadText`             | メモ（軽量メモ機能。nav: /memos、ページヘッダー、quick-capture のメモモードタブ。注: `NotebookTabs`＝ノート、`StickyNote`＝検索結果のノート種別と混同しないこと） |
| `Sunrise`                 | 自律活動デイリーレポート（nav: /agents/daily-report。ページ見出し・バックログ定期ジョブ daily_report — 同一概念の再利用。注: /agents/growth＝成長台帳とはルート・グリフとも別） |
| `ScanSearch`              | 検出漏れ兆候の学習・レビュー（nav: /agents/miss-signatures、ページ見出し、バックログ定期ジョブ miss_ledger — 同一概念の再利用。注: `Search`＝知識ブラウザとは別概念） |
| `Radar`                   | プリフライトprobeメトリクス（フェーズ遷移前probeのターゲット別成功率・レイテンシ集計。`ProbeMetricsPanel` ヘッダー） |
| `Stethoscope`              | LLMエラー診断（信頼度スコア付き診断結果パネル、`ErrorDiagnosisPanel` ヘッダー。注: `src/components/category/icons` 等のカテゴリアイコンピッカー登録は中立的な再掲で対象外） |
