/**
 * エラーハンドリングの型定義・ユーティリティ
 *
 * エージェントエラーコード、エラークラス、エラー判定関数を定義
 */

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
