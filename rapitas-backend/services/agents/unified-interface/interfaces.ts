/**
 * プロバイダー・エージェントインターフェース定義
 *
 * AIプロバイダー、エージェント実行、セッション管理、
 * 並列実行制御の統一インターフェースを定義
 */

import type {
  AgentCapability,
  AgentStatus,
  AgentTask,
} from "../base-agent";
import type { ProviderId, ModelInfo, ProviderConfig, ValidationResult } from "./provider-config";
import type { AgentInstanceConfig, ExecutionOptions } from "./agent-config";
import type { OutputHandler, QuestionHandler, ProgressHandler } from "./handlers";
import type { ExtendedExecutionResult } from "./results";

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

// ==================== ユーティリティ型 ====================

/**
 * プロバイダー登録情報
 */
export type ProviderRegistration = {
  provider: IAgentProvider;
  priority: number;
  isDefault: boolean;
};
