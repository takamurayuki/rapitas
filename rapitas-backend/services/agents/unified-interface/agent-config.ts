/**
 * エージェント設定・実行オプションの型定義
 *
 * エージェントインスタンスの構成と実行時オプションを定義
 */

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
