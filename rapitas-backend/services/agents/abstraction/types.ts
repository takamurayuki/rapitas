/**
 * AIエージェント抽象化レイヤー - 型定義
 * 各AIエージェント（Claude Code, OpenAI Codex, Gemini等）を統一的に扱うための型定義
 */

// ============================================================================
// エージェント基本型
// ============================================================================

/**
 * エージェントの種類を識別するID
 */
export type AgentProviderId =
  | 'claude-code'    // Claude Code CLI
  | 'openai-codex'   // OpenAI Codex API
  | 'gemini'         // Google Gemini API
  | 'google-gemini'  // Gemini CLI
  | 'anthropic-api'  // Anthropic Messages API (直接)
  | 'custom';        // カスタム実装

/**
 * エージェントの実行状態
 */
export type AgentState =
  | 'idle'              // 待機中
  | 'initializing'      // 初期化中
  | 'running'           // 実行中
  | 'waiting_for_input' // ユーザー入力待ち
  | 'paused'            // 一時停止中
  | 'completing'        // 完了処理中
  | 'completed'         // 完了
  | 'failed'            // 失敗
  | 'cancelled'         // キャンセル
  | 'timeout';          // タイムアウト

/**
 * エージェントの能力定義
 */
export interface AgentCapabilities {
  // コア機能
  codeGeneration: boolean;      // コード生成
  codeReview: boolean;          // コードレビュー
  codeExecution: boolean;       // コード実行

  // ファイル操作
  fileRead: boolean;            // ファイル読み取り
  fileWrite: boolean;           // ファイル書き込み
  fileEdit: boolean;            // ファイル編集（差分適用）

  // 外部連携
  terminalAccess: boolean;      // ターミナル/シェルアクセス
  gitOperations: boolean;       // Git操作
  webSearch: boolean;           // Web検索
  webFetch: boolean;            // Webページ取得

  // タスク管理
  taskAnalysis: boolean;        // タスク分析・分解
  taskPlanning: boolean;        // 実行計画作成
  parallelExecution: boolean;   // 並列実行サポート

  // 対話機能
  questionAsking: boolean;      // ユーザーへの質問
  conversationMemory: boolean;  // 会話履歴の保持
  sessionContinuation: boolean; // セッション継続

  // 追加のカスタム能力
  [key: string]: boolean | undefined;
}

/**
 * エージェントのメタ情報
 */
export interface AgentMetadata {
  id: string;                   // ユニークID
  providerId: AgentProviderId;  // プロバイダーID
  name: string;                 // 表示名
  version?: string;             // バージョン
  description?: string;         // 説明
  modelId?: string;             // 使用モデルID
  endpoint?: string;            // APIエンドポイント
  createdAt: Date;              // 作成日時
  lastUsedAt?: Date;            // 最終使用日時
}

// ============================================================================
// 実行コンテキスト
// ============================================================================

/**
 * エージェント実行時のコンテキスト情報
 */
export interface AgentExecutionContext {
  // 実行識別
  executionId: string;          // 実行ID
  sessionId?: string;           // セッションID（継続実行用）
  parentExecutionId?: string;   // 親実行ID（サブタスク用）

  // 作業環境
  workingDirectory: string;     // 作業ディレクトリ
  repositoryUrl?: string;       // リポジトリURL
  branch?: string;              // ブランチ名

  // 実行オプション
  timeout?: number;             // タイムアウト（ミリ秒）
  maxRetries?: number;          // 最大リトライ回数
  priority?: 'low' | 'normal' | 'high' | 'urgent';

  // フラグ
  dryRun?: boolean;             // ドライラン（変更を実際には適用しない）
  verbose?: boolean;            // 詳細ログ出力
  autoApprove?: boolean;        // 自動承認
  dangerouslySkipPermissions?: boolean; // パーミッションチェックをスキップ

  // メタデータ
  metadata?: Record<string, unknown>;
}

/**
 * タスク定義
 */
export interface AgentTaskDefinition {
  // 基本情報
  id: string | number;
  title: string;
  description?: string;

  // プロンプト
  prompt?: string;              // 直接プロンプト
  optimizedPrompt?: string;     // 最適化されたプロンプト

  // タスク分析情報
  analysis?: TaskAnalysisResult;

  // 依存関係
  dependencies?: Array<string | number>;

  // 制約
  constraints?: TaskConstraints;
}

/**
 * タスク分析結果
 */
export interface TaskAnalysisResult {
  summary: string;
  complexity: 'simple' | 'medium' | 'complex';
  estimatedDuration?: number;   // 推定時間（分）
  subtasks?: SubtaskDefinition[];
  tips?: string[];
  risks?: string[];
}

/**
 * サブタスク定義
 */
export interface SubtaskDefinition {
  order: number;
  title: string;
  description: string;
  estimatedDuration?: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dependencies?: number[];
  parallelizable?: boolean;
}

/**
 * タスク制約
 */
export interface TaskConstraints {
  maxFiles?: number;            // 変更可能なファイル数上限
  allowedPaths?: string[];      // 変更可能なパス（glob）
  forbiddenPaths?: string[];    // 変更禁止パス（glob）
  allowedCommands?: string[];   // 実行可能なコマンド
  forbiddenCommands?: string[]; // 実行禁止コマンド
}

// ============================================================================
// 実行結果
// ============================================================================

/**
 * エージェント実行結果
 */
export interface AgentExecutionResult {
  // 基本結果
  success: boolean;
  state: AgentState;

  // 出力
  output: string;               // 主要出力
  structuredOutput?: unknown;   // 構造化出力（JSON等）
  errorMessage?: string;        // エラーメッセージ

  // 成果物
  artifacts?: AgentArtifact[];
  commits?: GitCommitInfo[];

  // メトリクス
  metrics?: ExecutionMetrics;

  // 質問/入力待ち状態
  pendingQuestion?: PendingQuestion;

  // セッション情報
  sessionId?: string;           // 継続用セッションID

  // デバッグ情報
  debugInfo?: ExecutionDebugInfo;
}

/**
 * 成果物（ファイル変更、コード生成等）
 */
export interface AgentArtifact {
  type: 'file' | 'code' | 'diff' | 'log' | 'image' | 'data';
  name: string;
  content: string;
  path?: string;
  language?: string;            // プログラミング言語
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Gitコミット情報
 */
export interface GitCommitInfo {
  hash: string;
  message: string;
  branch: string;
  author?: string;
  timestamp?: Date;
  filesChanged: number;
  additions: number;
  deletions: number;
}

/**
 * 実行メトリクス
 */
export interface ExecutionMetrics {
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  apiCalls?: number;
  toolCalls?: number;
  filesModified?: number;
  linesAdded?: number;
  linesDeleted?: number;
}

/**
 * 保留中の質問
 */
export interface PendingQuestion {
  questionId: string;
  text: string;
  category: 'clarification' | 'confirmation' | 'selection' | 'input';
  options?: QuestionOption[];
  multiSelect?: boolean;
  defaultValue?: string;
  timeout?: number;             // 質問のタイムアウト（秒）
  metadata?: Record<string, unknown>;
}

/**
 * 質問の選択肢
 */
export interface QuestionOption {
  label: string;
  value: string;
  description?: string;
  isDefault?: boolean;
}

/**
 * 実行デバッグ情報
 */
export interface ExecutionDebugInfo {
  logs: DebugLogEntry[];
  toolCalls?: ToolCallInfo[];
  rawOutput?: string;
  processInfo?: {
    pid?: number;
    exitCode?: number;
    signal?: string;
  };
}

/**
 * デバッグログエントリ
 */
export interface DebugLogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
}

/**
 * ツール呼び出し情報
 */
export interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  startTime: Date;
  endTime?: Date;
  success: boolean;
  error?: string;
}

// ============================================================================
// イベント
// ============================================================================

/**
 * エージェントイベントタイプ
 */
export type AgentEventType =
  | 'state_change'       // 状態変更
  | 'output'             // 出力（ストリーミング）
  | 'error'              // エラー
  | 'tool_start'         // ツール実行開始
  | 'tool_end'           // ツール実行終了
  | 'question'           // 質問発生
  | 'progress'           // 進捗更新
  | 'artifact'           // 成果物生成
  | 'commit'             // Gitコミット
  | 'metrics_update';    // メトリクス更新

/**
 * エージェントイベント基底型
 */
export interface AgentEventBase {
  type: AgentEventType;
  timestamp: Date;
  executionId: string;
  agentId: string;
}

/**
 * 状態変更イベント
 */
export interface StateChangeEvent extends AgentEventBase {
  type: 'state_change';
  previousState: AgentState;
  newState: AgentState;
  reason?: string;
}

/**
 * 出力イベント
 */
export interface OutputEvent extends AgentEventBase {
  type: 'output';
  content: string;
  isError: boolean;
  isPartial: boolean;     // ストリーミング中の部分出力
}

/**
 * エラーイベント
 */
export interface ErrorEvent extends AgentEventBase {
  type: 'error';
  error: Error;
  recoverable: boolean;
  context?: string;
}

/**
 * ツール開始イベント
 */
export interface ToolStartEvent extends AgentEventBase {
  type: 'tool_start';
  toolId: string;
  toolName: string;
  input: unknown;
}

/**
 * ツール終了イベント
 */
export interface ToolEndEvent extends AgentEventBase {
  type: 'tool_end';
  toolId: string;
  toolName: string;
  output: unknown;
  success: boolean;
  durationMs: number;
  error?: string;
}

/**
 * 質問イベント
 */
export interface QuestionEvent extends AgentEventBase {
  type: 'question';
  question: PendingQuestion;
}

/**
 * 進捗イベント
 */
export interface ProgressEvent extends AgentEventBase {
  type: 'progress';
  current: number;
  total: number;
  message?: string;
  subtask?: string;
}

/**
 * 成果物イベント
 */
export interface ArtifactEvent extends AgentEventBase {
  type: 'artifact';
  artifact: AgentArtifact;
}

/**
 * コミットイベント
 */
export interface CommitEvent extends AgentEventBase {
  type: 'commit';
  commit: GitCommitInfo;
}

/**
 * メトリクス更新イベント
 */
export interface MetricsUpdateEvent extends AgentEventBase {
  type: 'metrics_update';
  metrics: Partial<ExecutionMetrics>;
}

/**
 * 全イベント型のユニオン
 */
export type AgentEvent =
  | StateChangeEvent
  | OutputEvent
  | ErrorEvent
  | ToolStartEvent
  | ToolEndEvent
  | QuestionEvent
  | ProgressEvent
  | ArtifactEvent
  | CommitEvent
  | MetricsUpdateEvent;

/**
 * イベントハンドラ型
 */
export type AgentEventHandler<T extends AgentEvent = AgentEvent> = (event: T) => void | Promise<void>;

// ============================================================================
// プロバイダー設定
// ============================================================================

/**
 * プロバイダー共通設定
 */
export interface AgentProviderConfigBase {
  providerId: AgentProviderId;
  enabled: boolean;

  // 認証
  apiKey?: string;
  apiKeyEnvVar?: string;        // 環境変数から取得する場合

  // エンドポイント
  endpoint?: string;

  // デフォルト設定
  defaultModel?: string;
  defaultTimeout?: number;
  maxConcurrentExecutions?: number;

  // 機能フラグ
  features?: Partial<AgentCapabilities>;

  // カスタム設定
  customConfig?: Record<string, unknown>;
}

/**
 * Claude Code固有の設定
 */
export interface ClaudeCodeProviderConfig extends AgentProviderConfigBase {
  providerId: 'claude-code';
  cliPath?: string;             // CLIの実行パス
  dangerouslySkipPermissions?: boolean;
}

/**
 * OpenAI固有の設定
 */
export interface OpenAIProviderConfig extends AgentProviderConfigBase {
  providerId: 'openai-codex';
  organization?: string;
}

/**
 * Gemini API 固有の設定
 */
export interface GeminiProviderConfig extends AgentProviderConfigBase {
  providerId: 'gemini';
  projectId?: string;
  location?: string;
}

/**
 * Gemini CLI 固有の設定
 */
export interface GeminiCliProviderConfig extends AgentProviderConfigBase {
  providerId: 'google-gemini';
  cliPath?: string;              // CLIの実行パス
  projectId?: string;            // Google Cloud Project ID
  location?: string;             // Google Cloud region
  sandboxMode?: boolean;         // サンドボックスモード
  yolo?: boolean;                // 自動承認モード
  checkpointId?: string;         // チェックポイントIDでセッション継続
  allowedTools?: string[];       // 許可するツール
  disallowedTools?: string[];    // 禁止するツール
}

/**
 * Anthropic API固有の設定
 */
export interface AnthropicAPIProviderConfig extends AgentProviderConfigBase {
  providerId: 'anthropic-api';
  anthropicVersion?: string;
}

/**
 * 全プロバイダー設定のユニオン
 */
export type AgentProviderConfig =
  | ClaudeCodeProviderConfig
  | OpenAIProviderConfig
  | GeminiProviderConfig
  | GeminiCliProviderConfig
  | AnthropicAPIProviderConfig
  | AgentProviderConfigBase;

// ============================================================================
// ライフサイクルフック
// ============================================================================

/**
 * ライフサイクルフック定義
 */
export interface AgentLifecycleHooks {
  /**
   * 実行開始前に呼び出される
   * falseを返すと実行をキャンセル
   */
  beforeExecute?: (
    context: AgentExecutionContext,
    task: AgentTaskDefinition
  ) => Promise<boolean | void>;

  /**
   * 実行完了後に呼び出される
   */
  afterExecute?: (
    context: AgentExecutionContext,
    result: AgentExecutionResult
  ) => Promise<void>;

  /**
   * エラー発生時に呼び出される
   * 戻り値でリトライするかを制御
   */
  onError?: (
    context: AgentExecutionContext,
    error: Error,
    retryCount: number
  ) => Promise<{ retry: boolean; delay?: number }>;

  /**
   * 質問発生時に呼び出される
   * 自動応答を返すか、nullでユーザー入力を待つ
   */
  onQuestion?: (
    context: AgentExecutionContext,
    question: PendingQuestion
  ) => Promise<string | null>;

  /**
   * 状態変更時に呼び出される
   */
  onStateChange?: (
    context: AgentExecutionContext,
    previousState: AgentState,
    newState: AgentState
  ) => Promise<void>;

  /**
   * ツール実行前に呼び出される
   * falseを返すとツール実行をスキップ
   */
  beforeToolCall?: (
    context: AgentExecutionContext,
    toolName: string,
    input: unknown
  ) => Promise<boolean | void>;

  /**
   * ツール実行後に呼び出される
   */
  afterToolCall?: (
    context: AgentExecutionContext,
    toolName: string,
    input: unknown,
    output: unknown,
    success: boolean
  ) => Promise<void>;

  /**
   * 成果物生成時に呼び出される
   */
  onArtifact?: (
    context: AgentExecutionContext,
    artifact: AgentArtifact
  ) => Promise<void>;

  /**
   * シャットダウン時に呼び出される
   */
  onShutdown?: (
    context: AgentExecutionContext,
    reason: 'completed' | 'cancelled' | 'error' | 'timeout'
  ) => Promise<void>;
}

// ============================================================================
// ユーティリティ型
// ============================================================================

/**
 * 継続実行用のコンテキスト
 */
export interface ContinuationContext {
  sessionId: string;
  previousExecutionId: string;
  userResponse?: string;
  additionalContext?: string;
}

/**
 * バッチ実行用の設定
 */
export interface BatchExecutionOptions {
  maxConcurrency: number;       // 最大同時実行数
  continueOnError: boolean;     // エラー時も続行
  timeout?: number;             // 全体タイムアウト
  ordering?: 'sequential' | 'parallel' | 'dependency-based';
}

/**
 * エージェントヘルスチェック結果
 */
export interface AgentHealthStatus {
  healthy: boolean;
  available: boolean;
  latency?: number;             // レスポンス時間（ms）
  errors?: string[];
  lastCheck: Date;
  details?: Record<string, unknown>;
}
