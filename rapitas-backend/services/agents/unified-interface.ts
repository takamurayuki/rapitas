/**
 * AIエージェント統一インターフェース型定義
 *
 * 複数AIプロバイダー（Claude, OpenAI, Gemini等）を
 * 同一インターフェースで操作するための型定義
 */

import type {
  AgentCapability,
  AgentStatus,
  AgentTask,
  AgentExecutionResult,
  AgentArtifact,
  GitCommitInfo,
  QuestionType,
} from "./base-agent";
import type { QuestionDetails, QuestionKey } from "./question-detection";

// ==================== プロバイダー関連 ====================

/**
 * プロバイダー識別子
 */
export type ProviderId = "claude-code" | "openai-codex" | "google-gemini" | "custom";

/**
 * AIモデル情報
 */
export type ModelInfo = {
  /** モデルID（API用） */
  id: string;

  /** モデル名（表示用） */
  name: string;

  /** モデルの説明 */
  description?: string;

  /** コンテキストウィンドウサイズ（トークン数） */
  contextWindow: number;

  /** 最大出力トークン数 */
  maxOutputTokens: number;

  /** 入力トークン単価（USD/1K tokens） */
  inputCostPer1k?: number;

  /** 出力トークン単価（USD/1K tokens） */
  outputCostPer1k?: number;

  /** 推奨用途 */
  recommendedFor?: ("code_generation" | "code_review" | "analysis" | "chat")[];

  /** 非推奨かどうか */
  deprecated?: boolean;
};

/**
 * プロキシ設定
 */
export type ProxyConfig = {
  host: string;
  port: number;
  auth?: {
    username: string;
    password: string;
  };
};

/**
 * レート制限設定
 */
export type RateLimitConfig = {
  /** 1分あたりのリクエスト数上限 */
  requestsPerMinute: number;

  /** 1分あたりのトークン数上限 */
  tokensPerMinute: number;
};

/**
 * プロバイダー設定
 */
export type ProviderConfig = {
  /** APIキー */
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

/**
 * 検証エラー
 */
export type ValidationError = {
  field: string;
  message: string;
  code: string;
};

/**
 * 検証警告
 */
export type ValidationWarning = {
  field: string;
  message: string;
  code: string;
};

/**
 * 設定検証結果
 */
export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
};

// ==================== エージェント設定 ====================

/**
 * エージェントインスタンス設定
 */
export type AgentInstanceConfig = {
  /** エージェントID（省略時は自動生成） */
  id?: string;

  /** エージェント名 */
  name: string;

  /** 使用するモデルID */
  modelId?: string;

  /** 作業ディレクトリ */
  workingDirectory?: string;

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

  /** カスタム設定 */
  custom?: Record<string, unknown>;
};

// ==================== 実行オプション ====================

/**
 * エージェント実行オプション
 */
export type ExecutionOptions = {
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

// ==================== ハンドラー ====================

/**
 * 出力ハンドラー
 */
export type OutputHandler = (output: string, isError?: boolean) => void;

/**
 * 質問情報
 */
export type QuestionInfo = {
  question: string;
  questionType: QuestionType;
  questionDetails?: QuestionDetails;
  questionKey?: QuestionKey;
};

/**
 * 質問検出ハンドラー
 */
export type QuestionHandler = (info: QuestionInfo) => void;

/**
 * 進捗ステージ
 */
export type ProgressStage = "initializing" | "analyzing" | "executing" | "completing";

/**
 * 進捗情報
 */
export type ProgressInfo = {
  stage: ProgressStage;
  percentage?: number;
  message?: string;
  currentStep?: string;
  totalSteps?: number;
};

/**
 * 進捗ハンドラー
 */
export type ProgressHandler = (progress: ProgressInfo) => void;

// ==================== 実行結果（拡張） ====================

/**
 * 実行メトリクス
 */
export type ExecutionMetrics = {
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

/**
 * 拡張実行結果
 */
export type ExtendedExecutionResult = AgentExecutionResult & {
  /** 入力トークン数 */
  inputTokens?: number;

  /** 出力トークン数 */
  outputTokens?: number;

  /** エラーコード */
  errorCode?: string;

  /** セッションID（プロバイダー共通形式） */
  sessionId?: string;

  /** モデルID（使用されたモデル） */
  modelId?: string;

  /** 警告メッセージ */
  warnings?: string[];

  /** 実行メトリクス */
  metrics?: ExecutionMetrics;
};

// ==================== エラー ====================

/**
 * エージェントエラーコード
 */
export enum AgentErrorCode {
  // 設定エラー (1xxx)
  CONFIG_INVALID = "E1001",
  CONFIG_API_KEY_MISSING = "E1002",
  CONFIG_ENDPOINT_UNREACHABLE = "E1003",

  // 実行エラー (2xxx)
  EXECUTION_TIMEOUT = "E2001",
  EXECUTION_CANCELLED = "E2002",
  EXECUTION_FAILED = "E2003",
  EXECUTION_RATE_LIMITED = "E2004",

  // セッションエラー (3xxx)
  SESSION_EXPIRED = "E3001",
  SESSION_NOT_FOUND = "E3002",
  SESSION_INVALID = "E3003",

  // 質問エラー (4xxx)
  QUESTION_TIMEOUT = "E4001",
  QUESTION_INVALID_RESPONSE = "E4002",

  // 並列実行エラー (5xxx)
  PARALLEL_DEPENDENCY_CYCLE = "E5001",
  PARALLEL_RESOURCE_CONFLICT = "E5002",
  PARALLEL_MAX_AGENTS_EXCEEDED = "E5003",

  // プロバイダーエラー (9xxx)
  PROVIDER_UNAVAILABLE = "E9001",
  PROVIDER_AUTH_FAILED = "E9002",
  PROVIDER_QUOTA_EXCEEDED = "E9003",
}

/**
 * エージェントエラークラス
 */
export class AgentError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = "AgentError";
  }

  /**
   * エラー情報をJSON形式で取得
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      recoverable: this.recoverable,
    };
  }
}

// ==================== インターフェース ====================

/**
 * AIエージェントプロバイダーインターフェース
 *
 * 各プロバイダー（Claude, OpenAI, Gemini等）はこのインターフェースを実装
 */
export interface IAgentProvider {
  /** プロバイダー識別子 */
  readonly providerId: ProviderId;

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

/**
 * AIエージェント実行インターフェース
 *
 * タスク実行、状態管理、出力処理を統一
 */
export interface IAgent {
  /** エージェントID */
  readonly id: string;

  /** エージェント名 */
  readonly name: string;

  /** プロバイダーID */
  readonly providerId: ProviderId;

  /** 現在のステータスを取得 */
  getStatus(): AgentStatus;

  /** 能力を取得 */
  getCapabilities(): AgentCapability;

  /** タスクを実行 */
  execute(task: AgentTask, options?: ExecutionOptions): Promise<ExtendedExecutionResult>;

  /** 会話を継続（質問への回答後） */
  continueExecution(response: string, sessionId: string): Promise<ExtendedExecutionResult>;

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

/**
 * エージェントセッション管理インターフェース
 *
 * 会話の継続、状態の永続化を統一
 */
export interface IAgentSession {
  /** セッションID */
  readonly sessionId: string;

  /** エージェントID */
  readonly agentId: string;

  /** プロバイダーID */
  readonly providerId: ProviderId;

  /** 作成日時 */
  readonly createdAt: Date;

  /** 最終アクティビティ日時 */
  lastActivityAt: Date;

  /** セッションが有効かどうか */
  isValid(): boolean;

  /** セッションを無効化 */
  invalidate(): void;

  /** セッション状態を保存 */
  save(): Promise<void>;

  /** セッション状態を復元 */
  restore(sessionId: string): Promise<boolean>;

  /** セッションメタデータを取得 */
  getMetadata(): Record<string, unknown>;

  /** セッションメタデータを更新 */
  updateMetadata(metadata: Record<string, unknown>): void;
}

// ==================== 並列実行統合 ====================

/**
 * サブエージェントハンドル
 */
export type SubAgentHandle = {
  agentId: string;
  taskId: number;
  providerId: ProviderId;
  status: AgentStatus;
};

/**
 * 並列実行オプション
 */
export type ParallelExecutionOptions = {
  /** 最大同時実行数 */
  maxConcurrent: number;

  /** 使用するプロバイダーID（省略時はデフォルト） */
  providerId?: ProviderId;

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

/**
 * サブエージェントコントローラーインターフェース
 */
export interface ISubAgentController {
  /** 複数エージェントを並列起動 */
  startAgents(tasks: AgentTask[], options: ParallelExecutionOptions): Promise<SubAgentHandle[]>;

  /** 特定エージェントを停止 */
  stopAgent(agentId: string): Promise<void>;

  /** 全エージェントを停止 */
  stopAll(): Promise<void>;

  /** エージェントの状態を取得 */
  getAgentState(agentId: string): SubAgentHandle | undefined;

  /** 全エージェントの状態を取得 */
  getAllStates(): Map<string, SubAgentHandle>;

  /** 質問への回答を送信 */
  answerQuestion(agentId: string, response: string): Promise<void>;
}

// ==================== ユーティリティ ====================

/**
 * プロバイダー登録情報
 */
export type ProviderRegistration = {
  provider: IAgentProvider;
  priority: number;
  isDefault: boolean;
};

/**
 * デフォルトの実行オプションを取得
 */
export function getDefaultExecutionOptions(): ExecutionOptions {
  return {
    timeout: 900000, // 15分
    enableStreaming: true,
    questionTimeoutSeconds: 300, // 5分
    autoApproveFileOperations: true,
    autoApproveTerminalCommands: true,
  };
}

/**
 * 実行オプションをマージ
 */
export function mergeExecutionOptions(
  base: ExecutionOptions,
  override?: Partial<ExecutionOptions>
): ExecutionOptions {
  if (!override) {
    return { ...base };
  }
  return { ...base, ...override };
}

/**
 * AgentErrorかどうかを判定
 */
export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError;
}

/**
 * リカバリー可能なエラーかどうかを判定
 */
export function isRecoverableError(error: unknown): boolean {
  if (isAgentError(error)) {
    return error.recoverable;
  }
  return false;
}

// 既存の型を再エクスポート（利便性のため）
export type {
  AgentCapability,
  AgentStatus,
  AgentTask,
  AgentExecutionResult,
  AgentArtifact,
  GitCommitInfo,
  QuestionType,
} from "./base-agent";

export type { QuestionDetails, QuestionKey } from "./question-detection";
