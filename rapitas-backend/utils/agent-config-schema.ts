/**
 * Agent Config Schema
 *
 * Defines per-agent-type configuration schemas and validation logic.
 */

export interface ConfigFieldSchema {
  name: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'select' | 'number' | 'boolean';
  description?: string;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
  };
}

export interface AgentConfigSchema {
  agentType: string;
  displayName: string;
  description: string;
  apiKeyRequired: boolean;
  apiKeyLabel?: string;
  apiKeyPrefix?: string;
  apiKeyPlaceholder?: string;
  endpointRequired: boolean;
  defaultEndpoint?: string;
  modelRequired: boolean;
  availableModels?: Array<{ value: string; label: string }>;
  defaultModel?: string;
  additionalFields?: ConfigFieldSchema[];
  capabilities: {
    codeGeneration: boolean;
    codeReview: boolean;
    taskAnalysis: boolean;
    fileOperations: boolean;
    terminalAccess: boolean;
    gitOperations?: boolean;
    webSearch?: boolean;
  };
}

/** Per-agent-type configuration schema definitions. */
const agentConfigSchemas: Record<string, AgentConfigSchema> = {
  'claude-code': {
    agentType: 'claude-code',
    displayName: 'Claude Code',
    description: 'Claude Code CLIを使用してコード生成・編集を行うエージェント',
    apiKeyRequired: false,
    endpointRequired: false,
    modelRequired: false,
    availableModels: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
    ],
    defaultModel: 'claude-sonnet-4-20250514',
    additionalFields: [
      {
        name: 'dangerouslySkipPermissions',
        label: 'パーミッションスキップ',
        type: 'boolean',
        description: '危険: パーミッション確認をスキップします（開発環境のみ）',
      },
      {
        name: 'maxTokens',
        label: '最大トークン数',
        type: 'number',
        description: 'レスポンスの最大トークン数',
        validation: { min: 1000, max: 100000 },
      },
    ],
    capabilities: {
      codeGeneration: true,
      codeReview: true,
      taskAnalysis: true,
      fileOperations: true,
      terminalAccess: true,
      gitOperations: true,
      webSearch: true,
    },
  },
  'anthropic-api': {
    agentType: 'anthropic-api',
    displayName: 'Anthropic API',
    description: 'Anthropic APIを直接使用するエージェント',
    apiKeyRequired: true,
    apiKeyLabel: 'Anthropic API Key',
    apiKeyPrefix: 'sk-ant-',
    apiKeyPlaceholder: 'sk-ant-api03-...',
    endpointRequired: false,
    defaultEndpoint: 'https://api.anthropic.com',
    modelRequired: false,
    availableModels: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
      { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    ],
    defaultModel: 'claude-sonnet-4-20250514',
    capabilities: {
      codeGeneration: true,
      codeReview: true,
      taskAnalysis: true,
      fileOperations: false,
      terminalAccess: false,
      gitOperations: false,
      webSearch: false,
    },
  },
  codex: {
    agentType: 'codex',
    displayName: 'Codex CLI',
    description: 'Codex CLIを使用したコード補完エージェント',
    apiKeyRequired: false,
    endpointRequired: false,
    modelRequired: false,
    availableModels: [
      { value: 'codex-mini-latest', label: 'Codex Mini' },
      { value: 'o4-mini', label: 'o4-mini' },
      { value: 'o3', label: 'o3' },
      { value: 'gpt-4.1', label: 'GPT-4.1' },
    ],
    defaultModel: 'codex-mini-latest',
    additionalFields: [
      {
        name: 'temperature',
        label: 'Temperature',
        type: 'number',
        description: '出力のランダム性（0-2）',
        validation: { min: 0, max: 2 },
      },
    ],
    capabilities: {
      codeGeneration: true,
      codeReview: true,
      taskAnalysis: true,
      fileOperations: false,
      terminalAccess: false,
      gitOperations: false,
      webSearch: false,
    },
  },
  openai: {
    agentType: 'openai',
    displayName: 'OpenAI',
    description: 'OpenAI APIを使用したAIエージェント',
    apiKeyRequired: true,
    apiKeyLabel: 'OpenAI API Key',
    apiKeyPrefix: 'sk-',
    apiKeyPlaceholder: 'sk-...',
    endpointRequired: false,
    defaultEndpoint: 'https://api.openai.com/v1',
    modelRequired: false,
    availableModels: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { value: 'gpt-4', label: 'GPT-4' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    ],
    defaultModel: 'gpt-4o',
    additionalFields: [
      {
        name: 'temperature',
        label: 'Temperature',
        type: 'number',
        description: '出力のランダム性（0-2）',
        validation: { min: 0, max: 2 },
      },
      {
        name: 'organizationId',
        label: 'Organization ID',
        type: 'text',
        description: 'OpenAI組織ID（オプション）',
        placeholder: 'org-...',
      },
    ],
    capabilities: {
      codeGeneration: true,
      codeReview: true,
      taskAnalysis: true,
      fileOperations: false,
      terminalAccess: false,
      gitOperations: false,
      webSearch: false,
    },
  },
  'azure-openai': {
    agentType: 'azure-openai',
    displayName: 'Azure OpenAI',
    description: 'Azure OpenAI Serviceを使用したAIエージェント',
    apiKeyRequired: true,
    apiKeyLabel: 'Azure API Key',
    apiKeyPlaceholder: 'Azure API Key',
    endpointRequired: true,
    modelRequired: false,
    availableModels: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4', label: 'GPT-4' },
      { value: 'gpt-35-turbo', label: 'GPT-3.5 Turbo' },
    ],
    defaultModel: 'gpt-4o',
    capabilities: {
      codeGeneration: true,
      codeReview: true,
      taskAnalysis: true,
      fileOperations: false,
      terminalAccess: false,
      gitOperations: false,
      webSearch: false,
    },
  },
  gemini: {
    agentType: 'gemini',
    displayName: 'Gemini CLI',
    description: 'Gemini CLIを使用したAIエージェント',
    apiKeyRequired: false,
    endpointRequired: false,
    modelRequired: false,
    availableModels: [
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { value: 'gemini-2.0-flash-thinking', label: 'Gemini 2.0 Flash Thinking' },
    ],
    defaultModel: 'gemini-2.0-flash',
    additionalFields: [
      {
        name: 'safetySettings',
        label: '安全設定',
        type: 'select',
        description: 'コンテンツフィルタリングのレベル',
        options: [
          { value: 'default', label: 'デフォルト' },
          { value: 'permissive', label: '許容的' },
          { value: 'strict', label: '厳格' },
        ],
      },
    ],
    capabilities: {
      codeGeneration: true,
      codeReview: true,
      taskAnalysis: true,
      fileOperations: false,
      terminalAccess: false,
      gitOperations: false,
      webSearch: true,
    },
  },
  custom: {
    agentType: 'custom',
    displayName: 'カスタムエージェント',
    description: 'カスタムAPIエンドポイントを使用するエージェント',
    apiKeyRequired: false,
    apiKeyLabel: 'API Key',
    endpointRequired: true,
    modelRequired: false,
    additionalFields: [
      {
        name: 'headers',
        label: 'カスタムヘッダー',
        type: 'text',
        description: 'JSON形式のカスタムHTTPヘッダー',
        placeholder: '{"Authorization": "Bearer ..."}',
      },
      {
        name: 'requestFormat',
        label: 'リクエスト形式',
        type: 'select',
        description: 'APIリクエストの形式',
        options: [
          { value: 'openai', label: 'OpenAI互換' },
          { value: 'anthropic', label: 'Anthropic互換' },
          { value: 'custom', label: 'カスタム' },
        ],
      },
    ],
    capabilities: {
      codeGeneration: true,
      codeReview: true,
      taskAnalysis: false,
      fileOperations: false,
      terminalAccess: false,
      gitOperations: false,
      webSearch: false,
    },
  },
};

/**
 * Returns the configuration schema for a given agent type, or null if unknown.
 */
export function getAgentConfigSchema(agentType: string): AgentConfigSchema | null {
  return agentConfigSchemas[agentType] || null;
}

/**
 * Returns configuration schemas for all known agent types.
 */
export function getAllAgentConfigSchemas(): AgentConfigSchema[] {
  return Object.values(agentConfigSchemas);
}

/**
 * Validates API key format against the agent type's expected prefix and length.
 *
 * @param agentType - The agent type identifier
 * @param apiKey - The API key to validate
 * @returns Validation result with optional error message
 */
export function validateApiKeyFormat(
  agentType: string,
  apiKey: string,
): { valid: boolean; message?: string } {
  const schema = agentConfigSchemas[agentType];

  if (!schema) {
    return { valid: true }; // Allow unknown agent types
  }

  if (!schema.apiKeyRequired && !apiKey) {
    return { valid: true };
  }

  if (schema.apiKeyRequired && !apiKey) {
    return { valid: false, message: 'APIキーは必須です' };
  }

  if (schema.apiKeyPrefix && !apiKey.startsWith(schema.apiKeyPrefix)) {
    return {
      valid: false,
      message: `APIキーは「${schema.apiKeyPrefix}」で始まる必要があります`,
    };
  }

  if (apiKey.length < 10) {
    return { valid: false, message: 'APIキーが短すぎます' };
  }

  return { valid: true };
}

/**
 * Validates a full agent configuration (endpoint, model, additional fields).
 *
 * @param agentType - The agent type identifier
 * @param config - The configuration to validate
 * @returns Validation result with an array of error messages
 */
export function validateAgentConfig(
  agentType: string,
  config: {
    endpoint?: string | null;
    modelId?: string | null;
    additionalConfig?: Record<string, unknown>;
  },
): { valid: boolean; errors: string[] } {
  const schema = agentConfigSchemas[agentType];
  const errors: string[] = [];

  if (!schema) {
    return { valid: true, errors: [] };
  }

  if (schema.endpointRequired && !config.endpoint) {
    errors.push('エンドポイントURLは必須です');
  }

  if (config.endpoint) {
    try {
      new URL(config.endpoint);
    } catch {
      errors.push('無効なエンドポイントURLです');
    }
  }

  if (schema.modelRequired && !config.modelId) {
    errors.push('モデルの選択は必須です');
  }

  if (config.modelId && schema.availableModels) {
    const validModels = schema.availableModels.map((m) => m.value);
    if (!validModels.includes(config.modelId)) {
      errors.push(`無効なモデルです: ${config.modelId}`);
    }
  }

  if (schema.additionalFields && config.additionalConfig) {
    for (const field of schema.additionalFields) {
      const value = config.additionalConfig[field.name];

      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field.label}は必須です`);
        continue;
      }

      if (value !== undefined && value !== null && field.validation) {
        if (field.type === 'number' && typeof value === 'number') {
          if (field.validation.min !== undefined && value < field.validation.min) {
            errors.push(`${field.label}は${field.validation.min}以上である必要があります`);
          }
          if (field.validation.max !== undefined && value > field.validation.max) {
            errors.push(`${field.label}は${field.validation.max}以下である必要があります`);
          }
        }

        if (field.type === 'text' && typeof value === 'string') {
          if (
            field.validation.minLength !== undefined &&
            value.length < field.validation.minLength
          ) {
            errors.push(
              `${field.label}は${field.validation.minLength}文字以上である必要があります`,
            );
          }
          if (
            field.validation.maxLength !== undefined &&
            value.length > field.validation.maxLength
          ) {
            errors.push(
              `${field.label}は${field.validation.maxLength}文字以下である必要があります`,
            );
          }
          if (field.validation.pattern) {
            const regex = new RegExp(field.validation.pattern);
            if (!regex.test(value)) {
              errors.push(`${field.label}の形式が正しくありません`);
            }
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
