/**
 * フロントエンドバリデーションユーティリティ
 * 各設定項目の入力値検証とエラーメッセージ生成
 */

export type ValidationResult = {
  valid: boolean;
  error?: string;
};

/**
 * 必須フィールドのバリデーション
 */
export function validateRequired(
  value: string,
  fieldName: string
): ValidationResult {
  if (!value.trim()) {
    return { valid: false, error: `${fieldName}を入力してください` };
  }
  return { valid: true };
}

/**
 * 名前フィールドのバリデーション
 */
export function validateName(
  value: string,
  fieldName: string = "名前",
  minLength: number = 1,
  maxLength: number = 100
): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, error: `${fieldName}を入力してください` };
  }
  if (trimmed.length < minLength) {
    return {
      valid: false,
      error: `${fieldName}は${minLength}文字以上で入力してください`,
    };
  }
  if (trimmed.length > maxLength) {
    return {
      valid: false,
      error: `${fieldName}は${maxLength}文字以下で入力してください`,
    };
  }
  return { valid: true };
}

/**
 * URLのバリデーション
 */
export function validateUrl(
  value: string,
  fieldName: string = "URL",
  required: boolean = false
): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) {
      return { valid: false, error: `${fieldName}を入力してください` };
    }
    return { valid: true };
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        valid: false,
        error: `${fieldName}はHTTPまたはHTTPSプロトコルを使用してください`,
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: `${fieldName}の形式が正しくありません` };
  }
}

/**
 * APIキーのバリデーション（エージェントタイプ別）
 */
const API_KEY_PREFIXES: Record<string, { prefix: string; label: string }> = {
  "anthropic-api": { prefix: "sk-ant-api", label: "Anthropic APIキー" },
  openai: { prefix: "sk-", label: "OpenAI APIキー" },
  "azure-openai": { prefix: "", label: "Azure APIキー" },
  gemini: { prefix: "AIza", label: "Google AI APIキー" },
  codex: { prefix: "sk-", label: "OpenAI APIキー" },
};

export function validateApiKey(
  value: string,
  agentType?: string,
  required: boolean = false
): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) {
      return { valid: false, error: "APIキーを入力してください" };
    }
    return { valid: true };
  }

  if (trimmed.length < 10) {
    return { valid: false, error: "APIキーが短すぎます（10文字以上）" };
  }

  if (agentType && API_KEY_PREFIXES[agentType]) {
    const { prefix, label } = API_KEY_PREFIXES[agentType];
    if (prefix && !trimmed.startsWith(prefix)) {
      return {
        valid: false,
        error: `${label}は「${prefix}」で始まる必要があります`,
      };
    }
  }

  return { valid: true };
}

/**
 * Claude APIキーのバリデーション（DeveloperModeConfig用）
 */
export function validateClaudeApiKey(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, error: "APIキーを入力してください" };
  }
  if (trimmed.length < 10) {
    return { valid: false, error: "APIキーが短すぎます（10文字以上）" };
  }
  if (!trimmed.startsWith("sk-ant-api")) {
    return {
      valid: false,
      error: "Claude APIキーは「sk-ant-api」で始まる必要があります",
    };
  }
  return { valid: true };
}

/**
 * 数値フィールドのバリデーション
 */
export function validateNumber(
  value: number,
  fieldName: string,
  min?: number,
  max?: number
): ValidationResult {
  if (isNaN(value)) {
    return { valid: false, error: `${fieldName}は数値で入力してください` };
  }
  if (min !== undefined && value < min) {
    return {
      valid: false,
      error: `${fieldName}は${min}以上で入力してください`,
    };
  }
  if (max !== undefined && value > max) {
    return {
      valid: false,
      error: `${fieldName}は${max}以下で入力してください`,
    };
  }
  return { valid: true };
}

/**
 * 複数バリデーション結果の集約
 */
export function collectErrors(
  ...results: ValidationResult[]
): { valid: boolean; errors: string[] } {
  const errors = results
    .filter((r) => !r.valid && r.error)
    .map((r) => r.error!);
  return { valid: errors.length === 0, errors };
}

/**
 * バックエンドのvalidate-configエンドポイントを呼び出してサーバーサイドバリデーションを実行
 */
export async function validateConfigOnServer(
  apiBaseUrl: string,
  config: {
    agentType: string;
    apiKey?: string;
    endpoint?: string;
    modelId?: string;
    additionalConfig?: Record<string, unknown>;
  }
): Promise<{ valid: boolean; errors: string[] }> {
  try {
    const res = await fetch(`${apiBaseUrl}/agents/validate-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      errors: ["サーバーとの通信に失敗しました"],
    };
  }
}
