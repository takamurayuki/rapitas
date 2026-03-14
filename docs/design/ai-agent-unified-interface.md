# AIエージェント統一インターフェース設計書

## 1. 概要

本ドキュメントは、Rapitasプロジェクトにおける複数AIエージェント（Claude Code、OpenAI Codex、Google Gemini等）の統一インターフェース設計を定義します。

### 1.1 目的

- 異なるAIプロバイダーのエージェントを同一インターフェースで操作可能にする
- 新しいエージェントの追加を容易にする
- コードの保守性と拡張性を向上させる
- 並列実行システムとの統合を円滑にする

### 1.2 対象エージェント

| エージェント | プロバイダー | 実装状況 | 実行方式 |
|-------------|------------|---------|---------|
| Claude Code | Anthropic | ✅ 実装済み | CLI子プロセス |
| OpenAI Codex | OpenAI | ⏳ 未実装 | API直接呼び出し |
| Google Gemini | Google | ⏳ 未実装 | API直接呼び出し |
| Custom Agent | - | ⏳ 未実装 | カスタム |

---

## 2. 現状分析

### 2.1 既存アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend                                  │
│  (AIAssistantAccordion, CommentsSection)                        │
└─────────────────────┬───────────────────────────────────────────┘
                      │ REST API
┌─────────────────────▼───────────────────────────────────────────┐
│                     API Routes                                   │
│  (/tasks/:id/execute, /executions/:id/continue)                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│               AgentOrchestrator                                  │
│  - タスク実行管理                                                │
│  - 状態追跡とDB保存                                              │
│  - イベント配信                                                  │
│  - 質問タイムアウト管理                                          │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                 AgentFactory                                     │
│  - エージェント生成                                              │
│  - 能力別フィルタリング                                          │
│  - シングルトン管理                                              │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                   BaseAgent (抽象クラス)                         │
│  ├── ClaudeCodeAgent (実装済み)                                 │
│  ├── OpenAICodexAgent (未実装)                                  │
│  └── GeminiAgent (未実装)                                       │
└─────────────────────────────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│             Parallel Execution System                            │
│  - ParallelExecutor                                             │
│  - SubAgentController                                           │
│  - DependencyAnalyzer                                           │
│  - AgentCoordinator                                             │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 現在の型定義

#### AgentCapability（能力定義）
```typescript
type AgentCapability = {
  codeGeneration: boolean;   // コード生成
  codeReview: boolean;       // コードレビュー
  taskAnalysis: boolean;     // タスク分析
  fileOperations: boolean;   // ファイル操作
  terminalAccess: boolean;   // ターミナル実行
  gitOperations?: boolean;   // Git操作
  webSearch?: boolean;       // Web検索
};
```

#### AgentStatus（実行状態）
```typescript
type AgentStatus =
  | 'idle'               // 待機中
  | 'running'            // 実行中
  | 'paused'             // 一時停止
  | 'completed'          // 完了
  | 'failed'             // 失敗
  | 'cancelled'          // キャンセル
  | 'waiting_for_input'; // 入力待ち
```

#### AgentExecutionResult（実行結果）
```typescript
type AgentExecutionResult = {
  success: boolean;
  output: string;
  artifacts?: AgentArtifact[];
  tokensUsed?: number;
  executionTimeMs?: number;
  errorMessage?: string;
  commits?: GitCommitInfo[];
  waitingForInput?: boolean;
  question?: string;
  questionType?: QuestionType;
  questionDetails?: QuestionDetails;
  questionKey?: QuestionKey;
  claudeSessionId?: string;
};
```

---

## 3. 統一インターフェース設計

### 3.1 コアインターフェース

#### 3.1.1 IAgentProvider（エージェントプロバイダー）

```typescript
/**
 * AIエージェントプロバイダーの統一インターフェース
 * 各プロバイダー（Claude, OpenAI, Gemini等）はこのインターフェースを実装
 */
interface IAgentProvider {
  /** プロバイダー識別子 */
  readonly providerId: string;

  /** プロバイダー名（表示用） */
  readonly providerName: string;

  /** サポートするモデル一覧 */
  readonly supportedModels: ModelInfo[];

  /** プロバイダーの能力 */
  readonly capabilities: AgentCapability;

  /** 利用可能かどうかを確認 */
  isAvailable(): Promise<boolean>;

  /** 設定を検証 */
  validateConfig(config: ProviderConfig): Promise<ValidationResult>;

  /** エージェントインスタンスを作成 */
  createAgent(config: AgentInstanceConfig): IAgent;
}
```

#### 3.1.2 IAgent（エージェント実行インターフェース）

```typescript
/**
 * AIエージェントの実行インターフェース
 * タスク実行、状態管理、出力処理を統一
 */
interface IAgent {
  /** エージェントID */
  readonly id: string;

  /** エージェント名 */
  readonly name: string;

  /** プロバイダーID */
  readonly providerId: string;

  /** 現在のステータスを取得 */
  getStatus(): AgentStatus;

  /** 能力を取得 */
  getCapabilities(): AgentCapability;

  /** タスクを実行 */
  execute(task: AgentTask, options?: ExecutionOptions): Promise<AgentExecutionResult>;

  /** 会話を継続（質問への回答後） */
  continueExecution(response: string, sessionId: string): Promise<AgentExecutionResult>;

  /** 実行を停止 */
  stop(): Promise<void>;

  /** 実行を一時停止 */
  pause(): Promise<boolean>;

  /** 実行を再開 */
  resume(): Promise<boolean>;

  /** 出力ハンドラを設定 */
  setOutputHandler(handler: OutputHandler): void;

  /** 質問検出ハンドラを設定 */
  setQuestionHandler(handler: QuestionHandler): void;

  /** 進捗ハンドラを設定 */
  setProgressHandler(handler: ProgressHandler): void;
}
```

#### 3.1.3 IAgentSession（セッション管理）

```typescript
/**
 * エージェントセッション管理インターフェース
 * 会話の継続、状態の永続化を統一
 */
interface IAgentSession {
  /** セッションID */
  readonly sessionId: string;

  /** エージェントID */
  readonly agentId: string;

  /** 作成日時 */
  readonly createdAt: Date;

  /** 最終アクティビティ日時 */
  readonly lastActivityAt: Date;

  /** セッションが有効かどうか */
  isValid(): boolean;

  /** セッションを無効化 */
  invalidate(): void;

  /** セッション状態を保存 */
  save(): Promise<void>;

  /** セッション状態を復元 */
  restore(sessionId: string): Promise<boolean>;
}
```

### 3.2 型定義（追加・拡張）

#### 3.2.1 モデル情報

```typescript
/**
 * AIモデルの情報
 */
type ModelInfo = {
  /** モデルID（API用） */
  id: string;

  /** モデル名（表示用） */
  name: string;

  /** モデルの説明 */
  description?: string;

  /** コンテキストウィンドウサイズ */
  contextWindow: number;

  /** 最大出力トークン数 */
  maxOutputTokens: number;

  /** 入力トークン単価（USD/1K tokens） */
  inputCostPer1k?: number;

  /** 出力トークン単価（USD/1K tokens） */
  outputCostPer1k?: number;

  /** 推奨用途 */
  recommendedFor?: ('code_generation' | 'code_review' | 'analysis' | 'chat')[];

  /** 非推奨かどうか */
  deprecated?: boolean;
};
```

#### 3.2.2 プロバイダー設定

```typescript
/**
 * プロバイダーごとの設定
 */
type ProviderConfig = {
  /** API キー */
  apiKey?: string;

  /** カスタムエンドポイント */
  endpoint?: string;

  /** 組織ID（OpenAI等） */
  organizationId?: string;

  /** プロジェクトID（Google等） */
  projectId?: string;

  /** リージョン */
  region?: string;

  /** プロキシ設定 */
  proxy?: ProxyConfig;

  /** レート制限設定 */
  rateLimit?: RateLimitConfig;

  /** カスタム設定 */
  custom?: Record<string, unknown>;
};

type ProxyConfig = {
  host: string;
  port: number;
  auth?: { username: string; password: string };
};

type RateLimitConfig = {
  requestsPerMinute: number;
  tokensPerMinute: number;
};
```

#### 3.2.3 実行オプション

```typescript
/**
 * エージェント実行オプション
 */
type ExecutionOptions = {
  /** 作業ディレクトリ */
  workingDirectory?: string;

  /** 使用するモデルID */
  modelId?: string;

  /** タイムアウト（ミリ秒） */
  timeout?: number;

  /** ファイル操作の自動承認 */
  autoApproveFileOperations?: boolean;

  /** ターミナルコマンドの自動承認 */
  autoApproveTerminalCommands?: boolean;

  /** 会話を継続するか */
  continueConversation?: boolean;

  /** 再開するセッションID */
  resumeSessionId?: string;

  /** ストリーミング出力を有効にするか */
  enableStreaming?: boolean;

  /** 質問タイムアウト（秒） */
  questionTimeoutSeconds?: number;

  /** 最大トークン数 */
  maxTokens?: number;

  /** 温度パラメータ（0.0-1.0） */
  temperature?: number;

  /** システムプロンプト追加 */
  systemPromptAddition?: string;

  /** コンテキストファイル（参照用） */
  contextFiles?: string[];

  /** 環境変数 */
  environmentVariables?: Record<string, string>;
};
```

#### 3.2.4 ハンドラー型定義

```typescript
/**
 * 出力ハンドラー
 */
type OutputHandler = (output: string, isError?: boolean) => void;

/**
 * 質問検出ハンドラー
 */
type QuestionHandler = (info: QuestionInfo) => void;

type QuestionInfo = {
  question: string;
  questionType: QuestionType;
  questionDetails?: QuestionDetails;
  questionKey?: QuestionKey;
};

/**
 * 進捗ハンドラー
 */
type ProgressHandler = (progress: ProgressInfo) => void;

type ProgressInfo = {
  stage: 'initializing' | 'analyzing' | 'executing' | 'completing';
  percentage?: number;
  message?: string;
  currentStep?: string;
  totalSteps?: number;
};
```

#### 3.2.5 検証結果

```typescript
/**
 * 設定検証結果
 */
type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
};

type ValidationError = {
  field: string;
  message: string;
  code: string;
};

type ValidationWarning = {
  field: string;
  message: string;
  code: string;
};
```

### 3.3 拡張されたAgentTask

```typescript
/**
 * エージェントタスク（拡張版）
 */
type AgentTask = {
  /** タスクID */
  id: number;

  /** タスクタイトル */
  title: string;

  /** タスク説明 */
  description?: string | null;

  /** 追加コンテキスト */
  context?: string;

  /** 作業ディレクトリ */
  workingDirectory?: string;

  /** リポジトリURL */
  repositoryUrl?: string;

  /** AIタスク分析結果 */
  analysisInfo?: TaskAnalysisInfo;

  /** 最適化されたプロンプト */
  optimizedPrompt?: string;

  /** 再開用セッションID */
  resumeSessionId?: string;

  /** 親タスクID（サブタスクの場合） */
  parentTaskId?: number;

  /** 依存タスクID */
  dependencies?: number[];

  /** 優先度 */
  priority?: TaskPriority;

  /** 関連ファイル */
  relatedFiles?: string[];

  /** タグ */
  tags?: string[];

  /** メタデータ */
  metadata?: Record<string, unknown>;
};
```

### 3.4 拡張されたAgentExecutionResult

```typescript
/**
 * エージェント実行結果（拡張版）
 */
type AgentExecutionResult = {
  /** 成功したかどうか */
  success: boolean;

  /** 出力テキスト */
  output: string;

  /** 生成された成果物 */
  artifacts?: AgentArtifact[];

  /** 使用トークン数 */
  tokensUsed?: number;

  /** 入力トークン数 */
  inputTokens?: number;

  /** 出力トークン数 */
  outputTokens?: number;

  /** 実行時間（ミリ秒） */
  executionTimeMs?: number;

  /** エラーメッセージ */
  errorMessage?: string;

  /** エラーコード */
  errorCode?: string;

  /** Gitコミット情報 */
  commits?: GitCommitInfo[];

  /** 入力待ち状態 */
  waitingForInput?: boolean;

  /** 質問テキスト */
  question?: string;

  /** 質問タイプ */
  questionType?: QuestionType;

  /** 質問詳細 */
  questionDetails?: QuestionDetails;

  /** 質問キー */
  questionKey?: QuestionKey;

  /** セッションID */
  sessionId?: string;

  /** モデルID（使用されたモデル） */
  modelId?: string;

  /** 警告メッセージ */
  warnings?: string[];

  /** 実行メトリクス */
  metrics?: ExecutionMetrics;
};

type ExecutionMetrics = {
  /** APIコール回数 */
  apiCalls: number;

  /** ファイル読み取り数 */
  filesRead: number;

  /** ファイル書き込み数 */
  filesWritten: number;

  /** コマンド実行数 */
  commandsExecuted: number;

  /** 推定コスト（USD） */
  estimatedCost?: number;
};
```

---

## 4. プロバイダー別実装ガイドライン

### 4.1 Claude Code Agent

現在の実装を維持しつつ、統一インターフェースに準拠。

**実行方式**: CLI子プロセス（spawn）
**特徴**:
- ストリーミング出力
- AskUserQuestionツールによる質問検出
- セッション継続（--resume）
- ファイル操作・ターミナルアクセス

```typescript
class ClaudeCodeProvider implements IAgentProvider {
  readonly providerId = 'claude-code';
  readonly providerName = 'Claude Code';
  readonly supportedModels: ModelInfo[] = [
    {
      id: 'claude-3-5-sonnet',
      name: 'Claude 3.5 Sonnet',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      recommendedFor: ['code_generation', 'code_review', 'analysis'],
    },
    {
      id: 'claude-3-opus',
      name: 'Claude 3 Opus',
      contextWindow: 200000,
      maxOutputTokens: 4096,
      recommendedFor: ['analysis', 'code_review'],
    },
  ];
  // ...
}
```

### 4.2 OpenAI Codex Agent（設計）

**実行方式**: API直接呼び出し（REST/SDK）
**特徴**:
- Function calling による構造化出力
- Assistants API による会話継続
- Code Interpreter による実行環境

```typescript
class OpenAICodexProvider implements IAgentProvider {
  readonly providerId = 'openai-codex';
  readonly providerName = 'OpenAI Codex';
  readonly supportedModels: ModelInfo[] = [
    {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      inputCostPer1k: 0.01,
      outputCostPer1k: 0.03,
      recommendedFor: ['code_generation', 'analysis'],
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      contextWindow: 128000,
      maxOutputTokens: 16384,
      inputCostPer1k: 0.005,
      outputCostPer1k: 0.015,
      recommendedFor: ['code_generation', 'code_review'],
    },
  ];
  // ...
}
```

### 4.3 Google Gemini Agent（設計）

**実行方式**: API直接呼び出し（REST/SDK）
**特徴**:
- マルチモーダル入力対応
- 長いコンテキストウィンドウ
- Google Cloud統合

```typescript
class GeminiProvider implements IAgentProvider {
  readonly providerId = 'google-gemini';
  readonly providerName = 'Google Gemini';
  readonly supportedModels: ModelInfo[] = [
    {
      id: 'gemini-1.5-pro',
      name: 'Gemini 1.5 Pro',
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      recommendedFor: ['analysis', 'code_review'],
    },
    {
      id: 'gemini-1.5-flash',
      name: 'Gemini 1.5 Flash',
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      recommendedFor: ['code_generation'],
    },
  ];
  // ...
}
```

---

## 5. 並列実行システムとの統合

### 5.1 SubAgentController拡張

```typescript
interface ISubAgentController {
  /** 複数エージェントを並列起動 */
  startAgents(tasks: AgentTask[], options: ParallelExecutionOptions): Promise<SubAgentHandle[]>;

  /** 特定エージェントを停止 */
  stopAgent(agentId: string): Promise<void>;

  /** 全エージェントを停止 */
  stopAll(): Promise<void>;

  /** エージェントの状態を取得 */
  getAgentState(agentId: string): SubAgentState | undefined;

  /** 全エージェントの状態を取得 */
  getAllStates(): Map<string, SubAgentState>;

  /** 質問への回答を送信 */
  answerQuestion(agentId: string, response: string): Promise<void>;
}
```

### 5.2 並列実行オプション

```typescript
type ParallelExecutionOptions = {
  /** 最大同時実行数 */
  maxConcurrent: number;

  /** 使用するプロバイダーID（省略時はデフォルト） */
  providerId?: string;

  /** 作業ディレクトリ */
  workingDirectory: string;

  /** 質問タイムアウト（秒） */
  questionTimeoutSeconds: number;

  /** タスクタイムアウト（秒） */
  taskTimeoutSeconds: number;

  /** 失敗時リトライ */
  retryOnFailure: boolean;

  /** 最大リトライ回数 */
  maxRetries: number;

  /** ログ共有を有効にするか */
  logSharing: boolean;

  /** エージェント間協調を有効にするか */
  coordinationEnabled: boolean;
};
```

---

## 6. エラーハンドリング

### 6.1 エラーコード体系

```typescript
enum AgentErrorCode {
  // 設定エラー (1xxx)
  CONFIG_INVALID = 'E1001',
  CONFIG_API_KEY_MISSING = 'E1002',
  CONFIG_ENDPOINT_UNREACHABLE = 'E1003',

  // 実行エラー (2xxx)
  EXECUTION_TIMEOUT = 'E2001',
  EXECUTION_CANCELLED = 'E2002',
  EXECUTION_FAILED = 'E2003',
  EXECUTION_RATE_LIMITED = 'E2004',

  // セッションエラー (3xxx)
  SESSION_EXPIRED = 'E3001',
  SESSION_NOT_FOUND = 'E3002',
  SESSION_INVALID = 'E3003',

  // 質問エラー (4xxx)
  QUESTION_TIMEOUT = 'E4001',
  QUESTION_INVALID_RESPONSE = 'E4002',

  // 並列実行エラー (5xxx)
  PARALLEL_DEPENDENCY_CYCLE = 'E5001',
  PARALLEL_RESOURCE_CONFLICT = 'E5002',
  PARALLEL_MAX_AGENTS_EXCEEDED = 'E5003',

  // プロバイダーエラー (9xxx)
  PROVIDER_UNAVAILABLE = 'E9001',
  PROVIDER_AUTH_FAILED = 'E9002',
  PROVIDER_QUOTA_EXCEEDED = 'E9003',
}
```

### 6.2 エラー型定義

```typescript
class AgentError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = 'AgentError';
  }
}
```

---

## 7. 実装優先順位

### Phase 1: 基盤整備
1. 統一インターフェース型定義の追加
2. 既存ClaudeCodeAgentのリファクタリング
3. 新しいAgentFactoryの実装

### Phase 2: OpenAI Codex対応
1. OpenAICodexProviderの実装
2. Assistants API統合
3. テストケースの作成

### Phase 3: Google Gemini対応
1. GeminiProviderの実装
2. Vertex AI統合
3. テストケースの作成

### Phase 4: 並列実行最適化
1. マルチプロバイダー並列実行
2. 動的負荷分散
3. コスト最適化

---

## 8. 変更履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| 1.0.0 | 2026-02-05 | 初版作成 |

---

## 9. 付録

### 9.1 参照ファイル

- `rapitas-backend/services/agents/base-agent.ts` - 既存の抽象基底クラス
- `rapitas-backend/services/agents/agent-factory.ts` - 既存のファクトリー
- `rapitas-backend/services/agents/claude-code-agent.ts` - Claude Code実装
- `rapitas-backend/services/agents/question-detection.ts` - 質問検出システム
- `rapitas-backend/services/parallel-execution/types.ts` - 並列実行型定義

### 9.2 外部API参照

- [Anthropic Claude API](https://docs.anthropic.com/claude/reference)
- [OpenAI API](https://platform.openai.com/docs/api-reference)
- [Google Gemini API](https://ai.google.dev/docs)
