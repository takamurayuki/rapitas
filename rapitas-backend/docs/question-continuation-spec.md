# 質問継続実行とタイムアウト機能仕様書

## 概要

AIエージェント実行時の質問機能における重複実行防止とタイムアウト自動継続機能の仕様を定義する。

## 問題の背景

### 発生していた問題

1. **質問の複数回実行**
   - 質問検出時にDBステータスが複数回更新される
   - タイムアウトハンドラとユーザー応答が競合して重複実行される

2. **例外エラー**
   ```
   error: Execution is not waiting for input: running
   ```
   - `executeContinuation`呼び出し時にステータスが既に`running`に変更されている

## 解決策

### 1. 継続実行ロック機構

同一`executionId`に対する重複実行を防止するため、ロック機構を導入。

#### 型定義

```typescript
type ContinuationLockInfo = {
  executionId: number;
  lockedAt: Date;
  source: "user_response" | "auto_timeout";
};
```

#### メソッド

```typescript
// ロック取得（成功時true）
tryAcquireContinuationLock(executionId: number, source: string): boolean

// ロック解放
releaseContinuationLock(executionId: number): void

// ロック状態確認
hasContinuationLock(executionId: number): boolean
```

### 2. タイムアウト自動継続機能

ユーザーからの回答がない場合、デフォルト時間経過後にAIエージェントが独自の見解で自動的に継続する。

#### デフォルト設定

```typescript
const DEFAULT_QUESTION_TIMEOUT_SECONDS = 300;  // 5分
const MIN_QUESTION_TIMEOUT_SECONDS = 30;       // 30秒
const MAX_QUESTION_TIMEOUT_SECONDS = 1800;     // 30分
```

#### タイムアウト処理フロー

```
質問検出
    ↓
タイムアウトタイマー開始
    ↓
─────────────────────────────
↓                           ↓
ユーザー応答あり         タイムアウト発火
    ↓                       ↓
タイマーキャンセル      ロック取得試行
    ↓                       ↓
ロック取得試行         成功 → デフォルト回答で継続
    ↓                       ↓
成功 → 継続実行        失敗 → 処理スキップ
失敗 → エラー返却
```

### 3. デフォルト回答生成

タイムアウト時に質問タイプに応じたデフォルト回答を生成：

| 質問タイプ | デフォルト回答 |
|-----------|--------------|
| 選択肢あり | 最初の選択肢を選択 |
| confirmation | 「はい」 |
| selection | 「1」 |
| clarification | 「デフォルトの設定で続行してください」 |
| Yes/No系 | 「y」 |

## API変更

### executeContinuation（外部API用）

```typescript
async executeContinuation(
  executionId: number,
  response: string,
  options: Partial<ExecutionOptions> = {},
): Promise<AgentExecutionResult>
```

- ロック取得を試みる
- 既にロックされている場合は`{ success: false, errorMessage: "This execution is already being processed" }`を返す
- ステータスが`running`の場合もエラーを返す

### executeContinuationWithLock（ロック取得済み用）

```typescript
async executeContinuationWithLock(
  executionId: number,
  response: string,
  options: Partial<ExecutionOptions> = {},
): Promise<AgentExecutionResult>
```

- APIルートで既にロックを取得している場合に使用
- ロック取得をスキップし、内部処理を直接実行

## フロントエンド通知

### タイムアウト開始イベント

```typescript
{
  type: "execution_output",
  data: {
    questionTimeoutStarted: true,
    questionTimeoutSeconds: number,
    questionTimeoutDeadline: string (ISO 8601)
  }
}
```

### タイムアウト発火イベント

```typescript
{
  type: "execution_output",
  data: {
    questionTimeoutTriggered: true,
    autoResponse: string,
    message: "タイムアウトにより自動的に継続します"
  }
}
```

## 状態遷移図

```
                     ┌─────────────────────────────────────────┐
                     │                                         │
                     ▼                                         │
idle → running → waiting_for_input ─┬─→ running → completed   │
   │                  │             │      │                   │
   │                  │             │      └── failed         │
   │                  │             │                          │
   │                  │             └─→ (タイムアウト)          │
   │                  │                    ↓                   │
   │                  │                 running → ...          │
   │                  │                                        │
   └── failed        └── (ロック競合)                          │
                            ↓                                  │
                         スキップ ─────────────────────────────┘
```

## エラーハンドリング

### 1. ロック取得失敗

```typescript
// APIルートでの処理
if (!orchestrator.tryAcquireContinuationLock(executionId, "user_response")) {
  return {
    error: "This execution is already being processed",
    currentStatus: "processing",
  };
}
```

### 2. 例外発生時のロック解放

```typescript
try {
  // 処理
} catch (error) {
  // エラー処理
} finally {
  this.releaseContinuationLock(executionId);
}
```

### 3. ステータス復元

処理失敗時はステータスを`waiting_for_input`に復元：

```typescript
await prisma.agentExecution.update({
  where: { id: executionId },
  data: { status: "waiting_for_input" },
}).catch(() => {});
```

## テスト

### 単体テスト

`tests/continuation-lock.test.ts`:
- ロック取得・解放テスト
- 競合シナリオテスト
- タイムアウト処理テスト
- エラーハンドリングテスト

### 統合テスト

- ユーザー応答後のタイムアウトキャンセル確認
- タイムアウト後の自動継続確認
- 複数質問の連続処理確認

## 設定

### 環境変数（将来的な拡張）

```env
# 質問タイムアウトのデフォルト秒数
QUESTION_TIMEOUT_SECONDS=300
```

## バージョン

- 仕様バージョン: 1.0.0
- 作成日: 2025-02-04
- 対象ファイル:
  - `rapitas-backend/services/agents/agent-orchestrator.ts`
  - `rapitas-backend/services/agents/question-detection.ts`
  - `rapitas-backend/routes/ai-agent.ts`
  - `rapitas-backend/tests/continuation-lock.test.ts`
