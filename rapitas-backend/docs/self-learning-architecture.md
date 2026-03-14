# 自己学習型AIエージェントアーキテクチャ

## 1. システムアーキテクチャ図

```
┌─────────────────────────────────────────────────────────────────┐
│                      Task Input                                  │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Task Manager                                   │
│  (既存: services/agents/orchestrator/task-executor.ts)           │
│  タスクの受付・分配・進捗管理                                      │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Experiment Engine                                │
│  (services/self-learning/experiment-engine.ts)                   │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Research  │→│Hypothesis│→│  Plan    │→│ Execute  │        │
│  │          │  │          │  │          │  │          │        │
│  └──────────┘  └──────────┘  └──────────┘  └────┬─────┘        │
│       ▲                                          │               │
│       │         ┌──────────┐  ┌──────────┐       │               │
│       └─────────│  Learn   │←│ Evaluate │←──────┘               │
│                 │          │  │          │                        │
│                 └──────────┘  └──────────┘                        │
└───────┬─────────────┬───────────┬───────────────────────────────┘
        │             │           │
        ▼             ▼           ▼
┌──────────────┐ ┌──────────┐ ┌──────────────────────────────────┐
│Agent Workers │ │  Critic  │ │        Memory System              │
│(既存: agents/│ │  System  │ │                                    │
│ providers/)  │ │(critic.ts│ │  ┌─────────┐ ┌─────────┐         │
│              │ │          │ │  │  Short   │ │ Episode │         │
│ ・Claude Code│ │ 仮説検証  │ │  │ Memory  │ │ Memory  │         │
│ ・OpenAI    │ │ 計画チェック│ │  │(現タスク) │ │(実験ログ)│         │
│ ・Gemini    │ │ 品質評価  │ │  └─────────┘ └─────────┘         │
└──────────────┘ └──────────┘ │  ┌─────────────────────┐         │
                               │  │  Knowledge Memory    │         │
                               │  │  (既存: KnowledgeEntry│         │
                               │  │   + Knowledge Graph) │         │
                               │  └─────────────────────┘         │
                               └──────────────────────────────────┘
                                           │
                               ┌───────────┴───────────┐
                               ▼                       ▼
                    ┌──────────────────┐  ┌──────────────────────┐
                    │ Knowledge Graph  │  │   Learning Engine     │
                    │(knowledge-graph. │  │(learning-engine.ts)   │
                    │ ts)              │  │                        │
                    │                  │  │ ・失敗パターン分析      │
                    │  [concept]       │  │ ・成功戦略抽出          │
                    │     │            │  │ ・プロンプト改善        │
                    │  [problem]──     │  │ ・知識更新              │
                    │     │    │       │  └──────────────────────┘
                    │  [solution]      │
                    │     │            │
                    │  [technology]    │
                    └──────────────────┘
```

## 2. ディレクトリ構造

```
rapitas-backend/
├── prisma/
│   └── schema.prisma               # 新モデル追加
│       ├── Experiment               # 実験ログ
│       ├── Hypothesis               # 仮説管理
│       ├── CriticReview             # 評価レビュー
│       ├── KnowledgeGraphNode       # 知識グラフノード
│       ├── KnowledgeGraphEdge       # 知識グラフエッジ
│       ├── LearningPattern          # 学習パターン
│       ├── EpisodeMemory            # エピソード記憶
│       └── PromptEvolution          # プロンプト進化
│
├── services/
│   ├── self-learning/               # ★ 新規: 自己学習エンジン
│   │   ├── index.ts                 # エクスポート
│   │   ├── types.ts                 # 型定義
│   │   ├── experiment-engine.ts     # 実験ループ管理
│   │   ├── hypothesis.ts            # 仮説の生成・追跡・検証
│   │   ├── critic.ts                # 独立した評価エージェント
│   │   ├── learning-engine.ts       # パターン分析・プロンプト改善
│   │   ├── knowledge-graph.ts       # グラフ構造の知識管理
│   │   └── episode-memory.ts        # エピソード記憶
│   │
│   ├── memory/                      # 既存: 知識管理基盤
│   │   ├── rag/                     # RAG (Researchフェーズで利用)
│   │   ├── consolidation.ts         # 知識統合 (Learnフェーズで利用)
│   │   ├── forgetting.ts            # 忘却曲線
│   │   └── contradiction.ts         # 矛盾検出 (Criticで利用)
│   │
│   └── agents/                      # 既存: エージェント基盤
│       ├── orchestrator/            # タスク実行 (Executeフェーズ)
│       └── providers/               # AI プロバイダー
│
├── routes/
│   └── self-learning/               # ★ 新規: APIルート
│       ├── experiments.ts           # 実験管理API
│       ├── knowledge-graph.ts       # 知識グラフAPI
│       └── learning.ts              # 学習エンジンAPI
│
└── docs/
    ├── self-learning-architecture.md  # 本ドキュメント
    └── self-learning-rust-reference.rs # Rust設計サンプル
```

## 3. メモリDBスキーマ

### Memory の3層構造

| 層 | モデル | 用途 | ライフサイクル |
|---|---|---|---|
| **Short Memory** | Experiment (status=executing) | 現在のタスクコンテキスト | タスク実行中のみ |
| **Episode Memory** | EpisodeMemory | 実験の各フェーズの詳細記録 | 永続 (importance で重み付け) |
| **Knowledge Memory** | KnowledgeEntry + KnowledgeGraphNode | 抽象化された知識 | 忘却曲線で管理 |

### Experiment (実験ログ)
```sql
id            SERIAL PRIMARY KEY
taskId        INT            -- 関連タスクID
title         TEXT           -- 実験タイトル
status        VARCHAR(30)    -- created→researching→hypothesizing→planning→executing→evaluating→learning→completed/failed
research      JSON           -- 収集した情報
hypothesis    JSON           -- 生成した仮説
plan          JSON           -- 実行計画
execution     JSON           -- 実行詳細
result        JSON           -- 実行結果
evaluation    JSON           -- 評価指標
learning      JSON           -- 抽出した学び
confidence    FLOAT          -- 信頼度 (0-1.0)
duration      INT            -- 実行時間(ms)
```

### KnowledgeGraphNode (知識グラフノード)
```sql
id            SERIAL PRIMARY KEY
label         TEXT           -- ノード名 (UNIQUE with nodeType)
nodeType      VARCHAR(20)    -- concept | problem | solution | technology | pattern
description   TEXT
properties    JSON
weight        FLOAT          -- 重要度
accessCount   INT            -- アクセス回数
```

### KnowledgeGraphEdge (知識グラフエッジ)
```sql
id            SERIAL PRIMARY KEY
fromNodeId    INT REFERENCES KnowledgeGraphNode
toNodeId      INT REFERENCES KnowledgeGraphNode
edgeType      VARCHAR(20)    -- related | causes | solves | requires | part_of | similar_to
weight        FLOAT          -- 関係の強さ
UNIQUE(fromNodeId, toNodeId, edgeType)
```

## 4. エージェントワークフロー

### 完全なExperimentループ

```
1. Task Input
   └→ createExperiment(taskId, title)

2. Research Phase
   ├→ RAG検索 (既存KnowledgeEntryから)
   ├→ 類似実験の検索
   ├→ Knowledge Graph探索
   └→ saveEpisode(phase: "research")

3. Hypothesis Phase
   ├→ createHypothesis(content, reasoning)
   ├→ performReview(phase: "hypothesis")  ← Critic
   ├→ rankHypotheses()
   └→ saveEpisode(phase: "hypothesis")

4. Plan Phase
   ├→ 実行計画の作成 (steps, dependencies)
   ├→ performReview(phase: "plan")  ← Critic
   └→ saveEpisode(phase: "plan")

5. Execute Phase
   ├→ Agent Workerによる実行
   │   ├→ コード生成/編集
   │   ├→ コマンド実行
   │   └→ テスト実行
   └→ saveEpisode(phase: "execute")

6. Evaluate Phase
   ├→ テスト結果の評価
   ├→ performReview(phase: "execution")  ← Critic
   ├→ updateHypothesisStatus(validated/invalidated)
   └→ saveEpisode(phase: "evaluate")

7. Learn Phase
   ├→ analyzeFailure() or extractStrategy()
   ├→ createPattern() → LearningPattern保存
   ├→ recordPromptEvolution() → プロンプト改善
   ├→ addNode/addEdge() → Knowledge Graph更新
   ├→ createKnowledgeEntry() → Knowledge Memory更新
   └→ saveEpisode(phase: "learn")

8. Loop or Complete
   ├→ confidence < threshold → 2. Research (再ループ)
   └→ confidence >= threshold → updateExperiment(status: "completed")
```

## 5. 各モジュールの責務

### Task Manager (既存: task-executor.ts)
- タスクの受付・分配
- 実行の優先度管理
- 進捗の追跡

### Experiment Engine (experiment-engine.ts)
- 実験ライフサイクルの管理
- Research → Hypothesis → Plan → Execute → Evaluate → Learn ループの制御
- 実験データの永続化
- 過去の実験の検索・参照

### Hypothesis Manager (hypothesis.ts)
- AI による仮説の生成
- 仮説の信頼度・優先度によるランキング
- 仮説の検証結果の追跡
- 仮説の改訂チェーン管理

### Critic System (critic.ts)
- **仮説の妥当性チェック**: 根拠の有無、具体性、論理性を評価
- **計画の不足検出**: テスト戦略、リスク対策、ロールバック計画の有無
- **実装の品質チェック**: 実行結果の完全性、エラー処理の適切さ
- **評価スコア算出**: accuracy × 0.4 + logic × 0.35 + coverage × 0.25

### Learning Engine (learning-engine.ts)
- **失敗パターン分析**: 繰り返し発生する失敗の原因特定
- **成功戦略抽出**: 成功した実験からのベストプラクティス抽出
- **プロンプト改善**: before/after のプロンプト進化を記録・適用
- **パターン管理**: success_strategy, failure_pattern, optimization, anti_pattern

### Knowledge Graph (knowledge-graph.ts)
- **ノード管理**: concept, problem, solution, technology, pattern の5種類
- **エッジ管理**: related, causes, solves, requires, part_of, similar_to の6種類
- **グラフ探索**: BFS によるサブグラフ取得
- **ノード統合**: 重複ノードのマージ

### Episode Memory (episode-memory.ts)
- 各実験フェーズの詳細記録
- 類似エピソードの検索
- 実験の要約生成
- 重要度ベースのフィルタリング

## 6. API エンドポイント一覧

### Experiments API (/experiments)
| Method | Path | Description |
|--------|------|-------------|
| GET | / | 実験一覧 |
| GET | /:id | 実験詳細 |
| POST | / | 新規実験作成 |
| PUT | /:id | 実験更新 |
| POST | /:id/research | Research実行 |
| POST | /:id/evaluate | 評価実行 |
| GET | /:id/timeline | タイムライン |
| GET | /:id/summary | エピソード要約 |
| GET | /:id/hypotheses | 仮説一覧 |
| POST | /:id/hypotheses | 仮説作成 |
| PUT | /:id/hypotheses/:hId/status | 仮説ステータス更新 |
| POST | /:id/hypotheses/:hId/revise | 仮説改訂 |
| GET | /:id/hypotheses/ranking | 仮説ランキング |
| GET | /:id/reviews | レビュー一覧 |
| POST | /:id/reviews | レビュー実行 |
| POST | /:id/episodes | エピソード保存 |

### Knowledge Graph API (/knowledge-graph)
| Method | Path | Description |
|--------|------|-------------|
| GET | /nodes | ノード一覧 |
| GET | /nodes/:id | ノード詳細 |
| POST | /nodes | ノード追加 |
| GET | /nodes/:id/related | 関連ノード |
| POST | /edges | エッジ追加 |
| GET | /subgraph | サブグラフ取得 |
| POST | /nodes/merge | ノード統合 |
| GET | /stats | グラフ統計 |

### Learning API (/learning)
| Method | Path | Description |
|--------|------|-------------|
| GET | /patterns | パターン一覧 |
| POST | /patterns | パターン作成 |
| POST | /analyze/failure/:experimentId | 失敗分析 |
| POST | /analyze/strategy/:experimentId | 戦略抽出 |
| GET | /stats | 学習統計 |
| GET | /critic-scores | Criticスコア平均 |
| GET | /prompt-evolution | プロンプト進化履歴 |
| POST | /prompt-evolution | プロンプト進化記録 |
| GET | /episodes/search | エピソード検索 |
| GET | /episodes/stats | エピソード統計 |
