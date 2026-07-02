/**
 * validation
 *
 * Frontend validation utilities for settings inputs. Validators return a
 * language-neutral `{ code, params }` error instead of a formatted string —
 * callers resolve the final display text via `translateValidationError()` at
 * the UI layer (a `common.validation` next-intl translator) so messages stay
 * localized. Not responsible for server-side validation (see
 * `validateConfigOnServer`, which forwards backend-provided error strings
 * as-is).
 */

/** Error codes matching keys under the `common.validation` message namespace. */
export type ValidationErrorCode =
  | 'required'
  | 'minLength'
  | 'maxLength'
  | 'urlProtocol'
  | 'urlInvalid'
  | 'apiKeyRequired'
  | 'apiKeyTooShort'
  | 'apiKeyPrefixAnthropic'
  | 'apiKeyPrefixOpenai'
  | 'apiKeyPrefixGemini'
  | 'apiKeyPrefixClaude'
  | 'numberInvalid'
  | 'numberMin'
  | 'numberMax'
  | 'serverCommError';

/** Language-neutral validation error: a message key plus its interpolation params. */
export type ValidationError = {
  code: ValidationErrorCode;
  params?: Record<string, string | number>;
};

export type ValidationResult = {
  valid: boolean;
  error?: ValidationError;
};

/**
 * Translator shape accepted by {@link translateValidationError}. Structurally
 * matches next-intl's `useTranslations()` return value.
 */
export type ValidationTranslator = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/**
 * Resolves a validator's language-neutral error into a display string.
 *
 * @param t - Translator scoped to the `common.validation` namespace / `common.validation` にスコープした翻訳関数
 * @param error - Error returned by a validate* function / validate*関数が返したエラー
 * @returns Localized error message / ローカライズされたエラーメッセージ
 */
export function translateValidationError(t: ValidationTranslator, error: ValidationError): string {
  return t(error.code, error.params);
}

/**
 * Validates that a field is non-empty.
 *
 * @param value - Raw input value / 入力値
 * @param fieldName - Localized field label used in the error message / エラーメッセージに使うフィールド名
 * @returns Validation result / 検証結果
 */
export function validateRequired(value: string, fieldName: string): ValidationResult {
  if (!value.trim()) {
    return { valid: false, error: { code: 'required', params: { field: fieldName } } };
  }
  return { valid: true };
}

/**
 * Validates a name field's presence and length.
 *
 * @param value - Raw input value / 入力値
 * @param fieldName - Localized field label used in the error message / エラーメッセージに使うフィールド名
 * @param minLength - Minimum allowed length / 最小文字数
 * @param maxLength - Maximum allowed length / 最大文字数
 * @returns Validation result / 検証結果
 */
export function validateName(
  value: string,
  fieldName: string = '名前',
  minLength: number = 1,
  maxLength: number = 100,
): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, error: { code: 'required', params: { field: fieldName } } };
  }
  if (trimmed.length < minLength) {
    return {
      valid: false,
      error: { code: 'minLength', params: { field: fieldName, min: minLength } },
    };
  }
  if (trimmed.length > maxLength) {
    return {
      valid: false,
      error: { code: 'maxLength', params: { field: fieldName, max: maxLength } },
    };
  }
  return { valid: true };
}

/**
 * Validates a URL field's presence, format, and protocol.
 *
 * @param value - Raw input value / 入力値
 * @param fieldName - Localized field label used in the error message / エラーメッセージに使うフィールド名
 * @param required - Whether an empty value is invalid / 空値を無効とするか
 * @returns Validation result / 検証結果
 */
export function validateUrl(
  value: string,
  fieldName: string = 'URL',
  required: boolean = false,
): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) {
      return { valid: false, error: { code: 'required', params: { field: fieldName } } };
    }
    return { valid: true };
  }

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: { code: 'urlProtocol', params: { field: fieldName } } };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: { code: 'urlInvalid', params: { field: fieldName } } };
  }
}

/**
 * API key prefix requirements per agent type (エージェント種別ごとのAPIキー接頭辞).
 * `code` is omitted for providers with no required prefix (e.g. azure-openai) —
 * the prefix check below never fires for those.
 */
const API_KEY_PREFIXES: Record<string, { prefix: string; code?: ValidationErrorCode }> = {
  'anthropic-api': { prefix: 'sk-ant-api', code: 'apiKeyPrefixAnthropic' },
  openai: { prefix: 'sk-', code: 'apiKeyPrefixOpenai' },
  'azure-openai': { prefix: '' },
  gemini: { prefix: 'AIza', code: 'apiKeyPrefixGemini' },
  codex: { prefix: 'sk-', code: 'apiKeyPrefixOpenai' },
};

/**
 * Validates an API key's presence, minimum length, and provider-specific prefix.
 *
 * @param value - Raw input value / 入力値
 * @param agentType - Agent type key used to look up the expected prefix / 期待する接頭辞を引くエージェント種別
 * @param required - Whether an empty value is invalid / 空値を無効とするか
 * @returns Validation result / 検証結果
 */
export function validateApiKey(
  value: string,
  agentType?: string,
  required: boolean = false,
): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) {
      return { valid: false, error: { code: 'apiKeyRequired' } };
    }
    return { valid: true };
  }

  if (trimmed.length < 10) {
    return { valid: false, error: { code: 'apiKeyTooShort' } };
  }

  if (agentType && API_KEY_PREFIXES[agentType]) {
    const { prefix, code } = API_KEY_PREFIXES[agentType];
    if (prefix && code && !trimmed.startsWith(prefix)) {
      return { valid: false, error: { code } };
    }
  }

  return { valid: true };
}

/**
 * Validates a Claude (Anthropic) API key specifically (used by DeveloperModeConfig).
 *
 * @param value - Raw input value / 入力値
 * @returns Validation result / 検証結果
 */
export function validateClaudeApiKey(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, error: { code: 'apiKeyRequired' } };
  }
  if (trimmed.length < 10) {
    return { valid: false, error: { code: 'apiKeyTooShort' } };
  }
  if (!trimmed.startsWith('sk-ant-api')) {
    return { valid: false, error: { code: 'apiKeyPrefixClaude' } };
  }
  return { valid: true };
}

/**
 * Validates a numeric field against optional min/max bounds.
 *
 * @param value - Raw numeric value / 数値
 * @param fieldName - Localized field label used in the error message / エラーメッセージに使うフィールド名
 * @param min - Minimum allowed value / 最小値
 * @param max - Maximum allowed value / 最大値
 * @returns Validation result / 検証結果
 */
export function validateNumber(
  value: number,
  fieldName: string,
  min?: number,
  max?: number,
): ValidationResult {
  if (isNaN(value)) {
    return { valid: false, error: { code: 'numberInvalid', params: { field: fieldName } } };
  }
  if (min !== undefined && value < min) {
    return { valid: false, error: { code: 'numberMin', params: { field: fieldName, min } } };
  }
  if (max !== undefined && value > max) {
    return { valid: false, error: { code: 'numberMax', params: { field: fieldName, max } } };
  }
  return { valid: true };
}

/**
 * Aggregates multiple validation results into a combined pass/fail plus the
 * list of language-neutral errors. Callers translate each error via
 * {@link translateValidationError} when building a display message.
 *
 * @param results - Validation results to combine / 集約する検証結果
 * @returns Overall validity and the collected errors / 総合結果と収集したエラー一覧
 */
export function collectErrors(...results: ValidationResult[]): {
  valid: boolean;
  errors: ValidationError[];
} {
  const errors = results.filter((r) => !r.valid && r.error).map((r) => r.error!);
  return { valid: errors.length === 0, errors };
}

/**
 * Calls the backend's validate-config endpoint to run server-side validation.
 *
 * @param apiBaseUrl - Backend API base URL / バックエンドAPIベースURL
 * @param config - Agent configuration to validate / 検証するエージェント設定
 * @param t - Translator scoped to `common.validation`, used only for the local network-failure message (server-provided error strings are forwarded as-is) / `common.validation` にスコープした翻訳関数（ネットワーク失敗時のみ使用）
 * @returns Server validation result / サーバー検証結果
 */
export async function validateConfigOnServer(
  apiBaseUrl: string,
  config: {
    agentType: string;
    apiKey?: string;
    endpoint?: string;
    modelId?: string;
    additionalConfig?: Record<string, unknown>;
  },
  t: ValidationTranslator,
): Promise<{ valid: boolean; errors: string[] }> {
  try {
    const res = await fetch(`${apiBaseUrl}/agents/validate-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });

    const data = await res.json();
    return {
      valid: data.valid ?? false,
      errors: data.errors ?? [],
    };
  } catch {
    return {
      valid: false,
      errors: [t('serverCommError')],
    };
  }
}
