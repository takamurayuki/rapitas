/**
 * Provider Configuration Type Definitions
 *
 * Defines provider identification, model info, connection settings, and validation results.
 */

// ==================== Provider Types ====================

/**
 * Provider identifier
 */
export type ProviderId = 'claude-code' | 'openai-codex' | 'google-gemini' | 'custom';

/**
 * AI model information
 */
export type ModelInfo = {
  id: string;
  name: string;
  description?: string;
  /** In tokens */
  contextWindow: number;
  maxOutputTokens: number;
  /** USD per 1K tokens */
  inputCostPer1k?: number;
  /** USD per 1K tokens */
  outputCostPer1k?: number;
  recommendedFor?: ('code_generation' | 'code_review' | 'analysis' | 'chat')[];
  deprecated?: boolean;
};

/**
 * Proxy configuration
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
 * Rate limit configuration
 */
export type RateLimitConfig = {
  requestsPerMinute: number;
  tokensPerMinute: number;
};

/**
 * Provider configuration
 */
export type ProviderConfig = {
  apiKey?: string;
  endpoint?: string;
  /** Organization ID (e.g. OpenAI) */
  organizationId?: string;
  /** Project ID (e.g. Google) */
  projectId?: string;
  region?: string;
  proxy?: ProxyConfig;
  rateLimit?: RateLimitConfig;
  custom?: Record<string, unknown>;
};

/**
 * Validation error
 */
export type ValidationError = {
  field: string;
  message: string;
  code: string;
};

/**
 * Validation warning
 */
export type ValidationWarning = {
  field: string;
  message: string;
  code: string;
};

/**
 * Configuration validation result
 */
export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
};
