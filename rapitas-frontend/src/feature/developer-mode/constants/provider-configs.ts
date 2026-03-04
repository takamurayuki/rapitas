export type ModelInfo = {
  id: string;
  name: string;
  description?: string;
};

export type ProviderConfig = {
  name: string;
  color: string;
  defaultEndpoint?: string;
  defaultModel?: string;
  models: ModelInfo[];
  requiresApiKey: boolean;
};

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  'claude-code': {
    name: 'Claude Code',
    color: 'text-orange-500',
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Sonnet 4',
        description: '高速で実用的',
      },
      { id: 'claude-opus-4-20250514', name: 'Opus 4', description: '最高性能' },
    ],
    requiresApiKey: false,
  },
  'anthropic-api': {
    name: 'Anthropic API',
    color: 'text-orange-500',
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Sonnet 4',
        description: '高速で実用的',
      },
      { id: 'claude-opus-4-20250514', name: 'Opus 4', description: '最高性能' },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: '3.5 Sonnet',
        description: 'バランス型',
      },
    ],
    requiresApiKey: true,
  },
  openai: {
    name: 'OpenAI',
    color: 'text-green-500',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', description: 'マルチモーダル' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: '高速' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5', description: 'コスト効率' },
    ],
    requiresApiKey: true,
  },
  codex: {
    name: 'Codex CLI',
    color: 'text-green-500',
    defaultModel: 'codex-mini-latest',
    models: [
      {
        id: 'codex-mini-latest',
        name: 'Codex Mini',
        description: '高速・軽量',
      },
      { id: 'o4-mini', name: 'o4-mini', description: '推論モデル' },
      { id: 'o3', name: 'o3', description: '高性能推論' },
      { id: 'gpt-4.1', name: 'GPT-4.1', description: '汎用' },
    ],
    requiresApiKey: false,
  },
  gemini: {
    name: 'Gemini CLI',
    color: 'text-blue-500',
    defaultModel: 'gemini-2.0-flash',
    models: [
      {
        id: 'gemini-1.5-pro',
        name: '1.5 Pro',
        description: '最高性能・長文対応',
      },
      { id: 'gemini-1.5-flash', name: '1.5 Flash', description: 'バランス型' },
      { id: 'gemini-2.0-flash', name: '2.0 Flash', description: '最新・高速' },
      {
        id: 'gemini-2.0-flash-thinking',
        name: '2.0 Flash Thinking',
        description: '推論特化',
      },
    ],
    requiresApiKey: false,
  },
};

export function getModelName(agentType: string, modelId: string): string {
  const provider = PROVIDER_CONFIGS[agentType];
  if (!provider) return modelId;
  const model = provider.models.find((m) => m.id === modelId);
  return model ? model.name : modelId;
}

export function getProviderLabel(agentType: string): string {
  return PROVIDER_CONFIGS[agentType]?.name ?? agentType;
}
