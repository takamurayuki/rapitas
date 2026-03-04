# 並列実行システム仕様書

## 概要

並列実行システムは、サブタスク間の依存関係を分析し、Claude Codeのサブエージェントによる並列実行を実現するシステムです。

## アーキテクチャ

### コンポーネント構成

```
┌─────────────────────────────────────────────────────────────┐
│                    ParallelExecutor                          │
│  (メインオーケストレーター)                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ DependencyAnalyzer │  │ ParallelScheduler │                │
│  │ (依存関係分析)     │  │ (スケジューリング) │                │
│  └─────────────────┘  └─────────────────┘                  │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ SubAgentController│  │ AgentCoordinator │                 │
│  │ (サブエージェント) │  │ (エージェント連携) │                │
│  └─────────────────┘  └─────────────────┘                  │
│                                                             │
│  ┌─────────────────┐                                        │
│  │  LogAggregator   │                                        │
│  │ (ログ集約)       │                                        │
│  └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
```

## 依存関係分析

### 依存関係の種類

| タイプ | 説明 | 検出方法 |
|--------|------|----------|
| `file_sharing` | ファイル共有による依存 | 説明・プロンプトからファイルパスを抽出 |
| `sequential` | 明示的な順序依存 | `explicitDependencies`フィールド |
| `data_flow` | データフローによる依存 | 将来実装予定 |
| `resource` | リソース競合 | ファイルロック機構で検出 |

### 重みづけアルゴリズム

依存関係の強度（重み）は以下の要素で計算されます：

1. **共有ファイルの割合**: 各タスクの関連ファイル数に対する共有ファイルの割合
2. **ファイルタイプ**: 重要なファイル（index.ts, schema.prisma等）は重みが高い
3. **優先度**: 高優先度タスクは依存関係において先に実行される

```typescript
// 重み計算式
weight = (sharedFileRatio * 100) * fileTypeWeight

// ファイルタイプの重み
- index.* : 1.5
- schema.*, config.* : 1.3
- *.ts, *.tsx : 1.2
- *.css, *.scss : 1.1
```

### 並列実行可能性の判定

タスクの並列実行可能性は以下で判定されます：

1. **independenceScore**: 独立性スコア（0-100）
   - 70以上: 並列実行可能
   - 30未満: 高依存性（警告）

2. **parallelizability**: 並列化可能性スコア（0-100）
   - 依存・被依存タスク数から計算

## 並列実行グループ

### グループ構造

```typescript
type ParallelGroup = {
  groupId: number;
  level: number;           // 実行レベル（0から開始）
  taskIds: number[];       // グループ内のタスクID
  canRunParallel: boolean; // グループ内で並列実行可能か
  estimatedDuration: number;
  internalDependencies: DependencyEdge[];
  dependsOnGroups: number[];
};
```

### 実行順序

1. level 0 のグループから順に実行
2. 各グループ内のタスクは `maxConcurrentAgents` に従って並列実行
3. 依存グループが完了するまで次のレベルは開始されない

## API仕様

### エンドポイント

#### 依存関係分析

```
GET /parallel/tasks/:id/analyze
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "parentTaskId": 1,
    "subtaskCount": 5,
    "nodes": [
      {
        "id": 101,
        "title": "タスク1",
        "priority": "high",
        "depth": 0,
        "independenceScore": 85,
        "parallelizability": 90,
        "dependencies": [],
        "dependents": [102]
      }
    ],
    "edges": [
      {
        "fromTaskId": 101,
        "toTaskId": 102,
        "type": "file_sharing",
        "weight": 45,
        "sharedResources": ["index.ts"]
      }
    ],
    "criticalPath": [101, 102, 105],
    "parallelGroups": [...],
    "plan": {
      "executionOrder": [[101, 103], [102, 104], [105]],
      "estimatedTotalDuration": 4,
      "estimatedSequentialDuration": 9,
      "parallelEfficiency": 55,
      "maxConcurrency": 3
    },
    "recommendations": ["5個のタスクを3グループで並列実行できます"],
    "warnings": []
  }
}
```

#### 並列実行開始

```
POST /parallel/tasks/:id/execute
```

**リクエスト:**
```json
{
  "config": {
    "maxConcurrentAgents": 3,
    "questionTimeoutSeconds": 300,
    "taskTimeoutSeconds": 900,
    "retryOnFailure": true,
    "logSharing": true,
    "coordinationEnabled": true
  }
}
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session-1-1234567890",
    "agentSessionId": 1,
    "plan": {
      "groups": 3,
      "maxConcurrency": 3,
      "estimatedTotalDuration": 4,
      "parallelEfficiency": 55
    },
    "status": "running"
  }
}
```

#### セッション状態取得

```
GET /parallel/sessions/:sessionId/status
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "status": "running",
    "progress": 40,
    "completed": [101, 103],
    "running": [102],
    "pending": [104, 105],
    "failed": [],
    "blocked": []
  }
}
```

#### 実行ログ取得

```
GET /parallel/sessions/:sessionId/logs?taskId=101&level=error&limit=100
```

#### リアルタイムログストリーム

```
GET /parallel/sessions/:sessionId/logs/stream
```

SSE形式でリアルタイムにログを配信します。

## エージェント間連携

### リソースロック

ファイル競合を防ぐため、リソースロック機構を提供：

```typescript
// ロック要求
const lock = coordinator.requestResourceLock(agentId, taskId, "file.ts");
if (lock.status === "granted") {
  // ファイルを安全に操作
}

// ロック解放
coordinator.releaseResourceLock(agentId, "file.ts");
```

### データ共有

エージェント間でデータを共有：

```typescript
// データを共有
coordinator.shareData("api-schema", schema, agentId);

// 他のエージェントで取得
const schema = coordinator.getSharedData("api-schema");
```

### メッセージング

```typescript
// ブロードキャスト
coordinator.broadcastMessage({
  type: "task_completed",
  fromAgentId: "agent-1",
  toAgentId: "broadcast",
  payload: { taskId: 101 }
});

// 特定エージェントに送信
coordinator.sendMessage("agent-2", "agent-1", "data_share", { key: "value" });
```

## ログ集約

### フィルタリング

```typescript
// タスク別
aggregator.getLogsByTask(taskId, limit);

// エージェント別
aggregator.getLogsByAgent(agentId, limit);

// レベル別
aggregator.getErrorLogs(limit);

// タグ別
aggregator.getLogsByTag("git", limit);
```

### 自動タグ付け

メッセージから自動的にタグを抽出：

- `error`, `warning`: エラー・警告メッセージ
- `start`, `complete`: 開始・完了メッセージ
- `file`: ファイル操作
- `git`: Git操作
- `test`: テスト関連
- `build`: ビルド関連

## 設定オプション

```typescript
type ParallelExecutionConfig = {
  maxConcurrentAgents: number;      // 最大同時実行エージェント数（デフォルト: 3）
  questionTimeoutSeconds: number;   // 質問タイムアウト（デフォルト: 300）
  taskTimeoutSeconds: number;       // タスクタイムアウト（デフォルト: 900）
  retryOnFailure: boolean;          // 失敗時リトライ（デフォルト: true）
  maxRetries: number;               // 最大リトライ回数（デフォルト: 2）
  logSharing: boolean;              // ログ共有有効（デフォルト: true）
  coordinationEnabled: boolean;     // エージェント連携有効（デフォルト: true）
};
```

## 実行フロー

```
1. 依存関係分析
   ↓
2. ツリーマップ生成
   ↓
3. 並列グループ生成
   ↓
4. 実行プラン作成
   ↓
5. セッション開始
   ↓
6. レベル0のタスクを開始
   ↓
7. タスク完了 → 依存解決 → 次のタスクをスケジュール
   ↓
8. すべてのタスク完了 → セッション終了
```

## トラブルシューティング

### 循環依存が検出された

- 警告メッセージが出力されます
- タスクの依存関係を見直してください

### タスクがブロック状態

- 依存タスクが失敗している可能性があります
- `getSessionStatus` でfailedタスクを確認してください

### 並列効率が低い

- クリティカルパスが長い可能性があります
- タスクの分割を検討してください

## 将来の拡張予定

1. **データフロー依存の自動検出**: タスク間のデータ依存を自動検出
2. **動的優先度調整**: 実行状況に応じた優先度の動的変更
3. **リトライ戦略**: 失敗タスクの自動リトライ機能
4. **コスト最適化**: API使用量を考慮したスケジューリング
