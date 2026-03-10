/**
 * プロバイダー設定関連の型定義
 *
 * プロバイダーの識別、モデル情報、接続設定、検証結果を定義
 */

// ==================== プロバイダー関連 ====================

/**
 * プロバイダー識別子
 */
export type ProviderId = 'claude-code' | 'openai-codex' | 'google-gemini' | 'custom';

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
  recommendedFor?: ('code_generation' | 'code_review' | 'analysis' | 'chat')[];

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
