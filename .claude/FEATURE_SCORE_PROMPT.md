# rapitas 機能面スコアリング・プロンプト

このファイルを読み込んだエージェントは、rapitas を **機能面に特化した 100 点満点** で採点する。
コード品質ではなく **「ユーザーに提供される機能の幅 × 深さ × 競合優位」** を評価軸とする。
すべての判断は **計測コマンドで取れる客観値** に基づくこと。印象採点は禁止。

---

## 採点プロトコル

1. 下記 10 カテゴリすべての計測コマンドを実機で実行する。
2. 計測値を該当する **スコア表** に当てはめて点数化する。
3. 出力は **必ず最後の「## 採点レポート出力テンプレート」** の形式で書く。
4. 改善提案は以下を必ず守る:
   - **抽象語禁止**: 「品質向上」「より使いやすく」「最適化」「強化」「改善」「ブラッシュアップ」「リッチに」「適切に」「見直す」「充実させる」 — 全部禁止。
   - **数値必須**: 「N → M に増やす」「A モデルに B フィールド追加」「ファイルパス + 行番号」「latency p95 を XX ms 未満」。
   - **アクション動詞 + 具体的な対象 + 期限**: 「`schema/X.prisma` に `Y` モデル追加して `Z` API を新設、期限 YYYY-MM-DD」。
   - **テーブル化**: 改善案が 3 件以上ならテーブルで列に「現在値 / 目標値 / 必要工数 / 優先度」を分ける。
5. 競合との差別化は **3 ペインのテーブル** で出す（rapitas / 競合 A / 競合 B、行は機能観点）。

---

## 競合参照リスト

機能比較は以下の主要競合を念頭に置く:

| 領域 | 主な競合 |
| --- | --- |
| AI 自律エンジニアリングエージェント | Devin (Cognition), Claude Code, Aider, Cursor Composer, Continue, Codex |
| 階層型タスク管理 | Linear, Notion, ClickUp, Asana, Height, Motion |
| 知識管理 / メモリ | Notion, Obsidian, Mem.ai, Reflect |
| 学習・暗記 | Anki, Quizlet, RemNote |
| ローカルファースト生産性 | Obsidian, Logseq, Tana |
| ハビット / 時間管理 | Habitica, Forest, Toggl, RescueTime |

---

## カテゴリ別評価項目

### 1. AI エージェント実行能力（20 点）

| サブ項目 | 計測コマンド | 配点 |
| --- | --- | ---: |
| 1-1. マルチ CLI エージェント対応 | `ls rapitas-backend/services/agents/{claude-code,codex-cli-agent,gemini-cli-agent}` で 3 種類存在するか | 5 |
| 1-2. 自律ワークフロー (research → plan → implement → verify → PR) | `grep -rn "research_done\|plan_created\|verify_done" rapitas-backend/services/workflow/workflow-types.ts` で全フェーズ定義済み | 5 |
| 1-3. 質問応答プロトコル (question.md による中断再開) | `grep -rn "question.md\|awaiting_question" rapitas-backend` の hit 数 | 3 |
| 1-4. ハルシネーション検出 / フェーズバリデータ | `cat rapitas-backend/services/workflow/phase-output-validator.ts` で validateResearch/Plan/Verify 関数が揃っているか | 4 |
| 1-5. サブタスク自動分割 | `grep -n "subtask\|parentId" rapitas-backend/services/workflow/*.ts` の hit 数 | 3 |

**スコア表（共通）:** 各サブ項目について「存在 + 関数複数 + テストあり = 満点」「存在のみ = 半分」「未実装 = 0」。

---

### 2. タスク管理機能の幅（15 点）

| サブ項目 | 計測コマンド | 配点 |
| --- | --- | ---: |
| 2-1. 階層構造 (Category → Theme → Task → Subtask) | Prisma に `Category`, `Theme`, `Task` (parentId), `Subtask` 関連が揃うか | 4 |
| 2-2. ビュー多様性 (List / Kanban / Gantt / Calendar / Focus) | `ls rapitas-frontend/src/app/{tasks,kanban,gantt,calendar,focus}` の存在数 | 4 |
| 2-3. テンプレート / 繰り返し (TaskTemplate, TaskPattern) | Prisma model の存在 | 3 |
| 2-4. 優先度 / ラベル / 時間トラッキング | `Label`, `TaskLabel`, `priority`, `estimatedHours`, `TimeEntry` 全て存在 | 4 |

---

### 3. ワークフロー自動化の深さ（15 点）

| サブ項目 | 計測コマンド | 配点 |
| --- | --- | ---: |
| 3-1. 5 ロール (researcher/planner/reviewer/implementer/verifier) | `grep "workflow_role_" rapitas-backend/routes/ai/system-prompts/*` で 5 ロール seed | 4 |
| 3-2. 自動 commit / PR / merge | `grep "autoCommit\|autoCreatePR\|autoMergePR" rapitas-backend/routes/workflow/*.ts` の hit 数 | 3 |
| 3-3. plan_approved ヒューマンゲート | `grep "approve-plan\|plan_approved" rapitas-backend` の hit 数 | 2 |
| 3-4. ステータス遷移監査ログ | Prisma に `WorkflowTransition` model | 3 |
| 3-5. ロール切替 / フォールバック | `grep "fallback\|provider" rapitas-backend/services/workflow/role-provider-resolver.ts` の存在 | 3 |

---

### 4. ナレッジ・メモリ管理（10 点）

| サブ項目 | 計測コマンド | 配点 |
| --- | --- | ---: |
| 4-1. アイデアボックス (AI / 手動タスク化) | `ls rapitas-frontend/src/app/ideas` + `grep "convert-to-task" rapitas-backend/routes/memory/idea-box.ts` | 3 |
| 4-2. ナレッジグラフ (ノード + エッジ) | Prisma に `KnowledgeGraphNode`, `KnowledgeGraphEdge` | 2 |
| 4-3. RAG 埋め込み + 検索 | `cat rapitas-backend/services/memory/rag/embedding.ts` の関数数、`KnowledgeEntry.contentHash`/embedding 列 | 3 |
| 4-4. エピソード記憶 + 統合実行 | `EpisodeMemory`, `MemoryJournalEntry`, `ConsolidationRun`, `KnowledgeReconsolidation` 全て存在 | 2 |

---

### 5. 自己学習・自己改善（10 点）

| サブ項目 | 計測コマンド | 配点 |
| --- | --- | ---: |
| 5-1. PromptEvolution (システムプロンプトの自動進化) | Prisma model + `services/self-learning/prompt-ops.ts` の存在 | 3 |
| 5-2. Experiment / Hypothesis (A/B 系) | Prisma `Experiment`, `Hypothesis` model + `experiment-engine.ts` | 4 |
| 5-3. WorkflowOptimizationRule / WorkflowLearningRecord | Prisma model 2 種存在 | 3 |

---

### 6. 学習・暗記サブシステム（5 点）

| サブ項目 | 計測コマンド | 配点 |
| --- | --- | ---: |
| 6-1. フラッシュカード (FlashcardDeck + Flashcard) | Prisma + `routes/learning/flashcards/*` | 2 |
| 6-2. 試験ゴール / 学習目標 (ExamGoal, LearningGoal) | Prisma + 対応 route | 2 |
| 6-3. 学習継続 (StudyStreak) | Prisma model + ロジック | 1 |

---

### 7. 生産性 / 時間管理（10 点）

| サブ項目 | 計測コマンド | 配点 |
| --- | --- | ---: |
| 7-1. ポモドーロ (`PomodoroSession` + service) | Prisma + `services/scheduling/pomodoro-service.ts` | 2 |
| 7-2. デイリースケジュール / カレンダー (`ScheduleEvent`, `DailyScheduleBlock`) | Prisma + `routes/scheduling/*` | 3 |
| 7-3. ハビット (Habit + HabitLog) | Prisma + ページ | 2 |
| 7-4. 達成 / アチーブメント (gamification) | `app/achievements` + 関連ロジック | 1 |
| 7-5. レポート / 分析 (WeeklyReview, ActivityLog) | Prisma + reports ページ | 2 |

---

### 8. 外部統合・拡張性（10 点）

| サブ項目 | 計測コマンド | 配点 |
| --- | --- | ---: |
| 8-1. GitHub 統合 (PR/Issue/Review/Comment) | Prisma `GitHubPullRequest`, `GitHubIssue`, `GitHubPRReview`, `GitHubPRComment` 全て存在 | 3 |
| 8-2. MCP (Model Context Protocol) | `services/mcp/*` + route 存在 | 2 |
| 8-3. Local LLM | `services/local-llm/*` + route 存在 | 2 |
| 8-4. 音声書き起こし (Voice → Idea/Task) | `services/transcription/*` + `routes/system/transcribe.ts` | 2 |
| 8-5. スクリーンショット取込 (画面 → AI コンテキスト) | `services/screenshot/*` + route | 1 |

---

### 9. クロスプラットフォーム / UX（5 点）

| サブ項目 | 計測コマンド | 配点 |
| --- | --- | ---: |
| 9-1. Web + Desktop (Tauri 2) | `ls rapitas-desktop/src-tauri` 存在 + `package.json` の `dev:tauri` script | 2 |
| 9-2. ダークモード対応率 | `grep -rln "dark:" rapitas-frontend/src --include="*.tsx" \| wc -l` ÷ 全 tsx 数 | 1 |
| 9-3. i18n 多言語 | `ls rapitas-frontend/messages/*.json \| wc -l` (>=2 で満点) | 1 |
| 9-4. レスポンシブ (sm:/md:/lg: 利用) | `grep -rln "sm:\|md:\|lg:" rapitas-frontend/src --include="*.tsx" \| wc -l` (>=50 で満点) | 1 |

---

### 10. 競合差別化要素（5 点）

| サブ項目 | 評価軸 | 配点 |
| --- | --- | ---: |
| 10-1. AI agent + task system 縦串統合 | Linear/Notion は AI agent を持たない、Devin/Cursor は task tracking を持たない。両軸を 1 アプリ統合した稀少性 | 2 |
| 10-2. 5-role workflow (research/plan/review/implement/verify) | 役割分業のあるエージェント実装は Devin と少数のみ | 1 |
| 10-3. PromptEvolution / Self-learning | システムプロンプトを自動進化させる機構を持つ task app は商用で確認できない | 1 |
| 10-4. Local-first (Tauri + SQLite) + Web 両対応 | データ主権を保ちつつ Web 共有も可能なハイブリッド | 1 |

---

## 採点レポート出力テンプレート（必ずこの形式）

```markdown
# rapitas 機能面評価（YYYY-MM-DD）

## 総合: NN / 100

| # | カテゴリ | スコア | 失点理由（1 行） |
| -- | --- | ---: | --- |
| 1 | AI エージェント実行能力 | NN/20 | ... |
| 2 | タスク管理機能の幅 | NN/15 | ... |
| 3 | ワークフロー自動化の深さ | NN/15 | ... |
| 4 | ナレッジ・メモリ管理 | NN/10 | ... |
| 5 | 自己学習・自己改善 | NN/10 | ... |
| 6 | 学習・暗記サブシステム | NN/5 | ... |
| 7 | 生産性 / 時間管理 | NN/10 | ... |
| 8 | 外部統合・拡張性 | NN/10 | ... |
| 9 | クロスプラットフォーム / UX | NN/5 | ... |
| 10 | 競合差別化要素 | NN/5 | ... |

## 競合比較表

| 機能観点 | rapitas | 競合 A (例: Devin) | 競合 B (例: Linear) | 競合 C (例: Notion) |
| --- | --- | --- | --- | --- |
| 自律エンジニアリングエージェント | ✅ Multi-CLI (Claude/Codex/Gemini) | ✅ 独自 | ❌ | ❌ |
| 階層タスク管理 | ✅ Cat/Theme/Task/Subtask | ❌ | ✅ Project/Issue/SubIssue | ✅ Page hierarchy |
| 5-role workflow | ✅ | 部分的 | ❌ | ❌ |
| RAG / Knowledge graph | ✅ | ❌ | ❌ | 部分的 |
| ローカル DB (SQLite) | ✅ Tauri | ❌ | ❌ | ❌ |
| プロンプト自動進化 | ✅ PromptEvolution | ❌ | ❌ | ❌ |
| ポモドーロ / Habit | ✅ | ❌ | ❌ | プラグイン依存 |
| 音声書き起こし入力 | ✅ | ❌ | ❌ | ❌ |

## カテゴリ別 改善アクション（定量・具体）

### N. カテゴリ名（NN/MM）

| # | 現在値 (計測) | 目標値 | 必要アクション (具体) | 期限 |
| -- | --- | --- | --- | --- |
| 1 | "5-role の verifier prompt が Codex のみ未配信、3 / 5 ロール" | "5/5 配信 + テスト 1 件追加" | `default-prompts-workflow-riv.ts` の `workflow_role_verifier` を Codex provider 設定に登録、`tests/routes/ai/system-prompts.test.ts` に regression test 追加 | YYYY-MM-DD |

> 改善アクションは **抽象語ゼロ** で書く。「品質向上」「より良く」「強化」を含む文は不可。
```

採点プロトコルに違反したレポートは破棄して再採点する。
