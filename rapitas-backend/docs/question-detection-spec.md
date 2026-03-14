# AIエージェント質問検出システム仕様書

## 概要

AIエージェント（Claude Code）が質問を行う際の検出メカニズムを定義する。
従来のパターンマッチングベースの検出を廃止し、Claude Codeの`AskUserQuestion`ツール呼び出しに基づく特定キーベースの検出に一本化する。

## 質問検出方式

### 検出方法: AskUserQuestionツール呼び出し

Claude Codeがユーザーに質問する際は、必ず`AskUserQuestion`ツールを使用する。
このツール呼び出しはstream-json形式の出力から直接検出される。

#### stream-json出力例

```json
{
  "type": "assistant",
  "message": {
    "content": [
      {
        "type": "tool_use",
        "name": "AskUserQuestion",
        "id": "toolu_xxx",
        "input": {
          "questions": [
            {
              "question": "どのフレームワークを使用しますか？",
              "header": "Framework",
              "options": [
                {"label": "React", "description": "Reactを使用"},
                {"label": "Vue", "description": "Vueを使用"}
              ],
              "multiSelect": false
            }
          ]
        }
      }
    ]
  }
}
```

## 質問タイプ定義

```typescript
/**
 * 質問の種類を表す型
 * - 'tool_call': Claude CodeのAskUserQuestionツール呼び出しによる質問
 * - 'none': 質問なし
 */
export type QuestionType = 'tool_call' | 'none';
```

**注意:** `'pattern_match'`タイプは廃止。

## 質問検出結果フォーマット

```typescript
export type QuestionDetectionResult = {
  /** 質問が検出されたかどうか */
  hasQuestion: boolean;
  /** 質問内容（hasQuestionがtrueの場合） */
  question: string;
  /** 質問の検出方法 */
  questionType: QuestionType;
  /** 質問の詳細情報（オプション） */
  questionDetails?: {
    /** 質問のヘッダー（短いラベル） */
    headers?: string[];
    /** 選択肢がある場合の選択肢リスト */
    options?: Array<{
      label: string;
      description?: string;
    }>;
    /** 複数選択が可能かどうか */
    multiSelect?: boolean;
  };
};
```

## エージェント実行結果フォーマット

```typescript
export type AgentExecutionResult = {
  success: boolean;
  output: string;
  artifacts?: AgentArtifact[];
  tokensUsed?: number;
  executionTimeMs?: number;
  errorMessage?: string;
  commits?: GitCommitInfo[];
  // Question waiting state
  waitingForInput?: boolean;
  question?: string;
  /** Question detection method (tool_call: AskUserQuestion tool, none: no question) */
  questionType?: QuestionType;
  /** Question detailed information */
  questionDetails?: QuestionDetectionResult['questionDetails'];
};
```

## 質問待機状態の管理

### ステータス遷移

```
idle → running → waiting_for_input → running → completed
                      ↓
                    failed
```

### データベースフィールド

AgentExecutionテーブル:
- `status`: 実行状態（'waiting_for_input'を含む）
- `question`: 質問内容（テキスト）
- `questionType`: 質問検出方法（'tool_call' | null）
- `questionDetails`: 質問詳細（JSON）

## 実装ガイドライン

### 1. stream-json処理での検出

```typescript
// Process tool_use blocks in assistant messages
if (block.type === "tool_use" && block.name === "AskUserQuestion") {
  // Extract question content
  const questionText = extractQuestionText(block.input);
  const questionDetails = extractQuestionDetails(block.input);

  this.detectedQuestion = {
    hasQuestion: true,
    question: questionText,
    questionType: 'tool_call',
    questionDetails,
  };
}
```

### 2. プロセス終了時の判定

```typescript
// Only use AskUserQuestion tool calls detected from stream-json
const hasQuestion = this.detectedQuestion.hasQuestion;
const question = this.detectedQuestion.question;
const questionType = this.detectedQuestion.questionType;

// No fallback to pattern matching
```

### 3. SSEイベント形式

```typescript
// Question waiting state events
{
  type: 'execution_output',
  data: {
    output: string,
    waitingForInput: true,
    question: string,
    questionType: 'tool_call',
    questionDetails?: {
      headers: string[],
      options: Array<{label: string, description?: string}>,
      multiSelect: boolean
    }
  }
}
```

## 移行計画

1. パターンマッチング関連コードを削除
   - `detectQuestionByPattern()` メソッド
   - `detectAskUserQuestionToolCall()` メソッド（不要な部分）
   - `extractQuestionFromToolCall()` メソッド（不要な部分）
   - `detectQuestion()` メソッド（簡素化）

2. `QuestionType`型を更新
   - `'pattern_match'`を削除

3. 質問検出ロジックを簡素化
   - stream-json処理内での直接検出のみに統一

4. テストコード作成
   - 新しい検出ロジックの単体テスト
   - WebSocket/SSE通信の統合テスト

## バージョン

- 仕様バージョン: 1.0.0
- 作成日: 2025-01-28
- 対象ファイル:
  - `rapitas-backend/services/agents/base-agent.ts`
  - `rapitas-backend/services/agents/claude-code-agent.ts`
  - `rapitas-backend/services/agents/agent-orchestrator.ts`
