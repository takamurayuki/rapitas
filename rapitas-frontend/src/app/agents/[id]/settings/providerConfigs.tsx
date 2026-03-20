/**
 * providerConfigs
 *
 * Static configuration map for all supported AI provider types.
 * Centralizes provider metadata (icons, colors, defaults, capabilities).
 */

import { Terminal, Zap, Globe, Activity, Cpu } from 'lucide-react';

export type ProviderConfig = {
  name: string;
  icon: React.ReactNode;
  color: string;
  defaultEndpoint?: string;
  defaultModel?: string;
  models: Array<{ id: string; name: string; description?: string }>;
  requiresApiKey: boolean;
  apiKeyPlaceholder: string;
  apiKeyHelpUrl?: string;
  endpointEditable: boolean;
};

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  'claude-code': {
    name: 'Claude Code',
    icon: <Terminal className="w-5 h-5" />,
    color: 'text-orange-500',
    defaultModel: '',
    models: [],
    requiresApiKey: false,
    apiKeyPlaceholder: 'claudeCodeLocalCli',
    endpointEditable: false,
  },
  'anthropic-api': {
    name: 'Anthropic API',
    icon: <Terminal className="w-5 h-5" />,
    color: 'text-orange-500',
    defaultEndpoint: 'https://api.anthropic.com',
    defaultModel: '',
    models: [],
    requiresApiKey: true,
    apiKeyPlaceholder: 'sk-ant-api03-...',
    apiKeyHelpUrl: 'https://console.anthropic.com/settings/keys',
    endpointEditable: false,
  },
  codex: {
    name: 'Codex CLI',
    icon: <Zap className="w-5 h-5" />,
    color: 'text-green-500',
    defaultModel: '',
    models: [],
    requiresApiKey: false,
    apiKeyPlaceholder: 'codexLocalCli',
    endpointEditable: false,
  },
  openai: {
    name: 'OpenAI',
    icon: <Zap className="w-5 h-5" />,
    color: 'text-green-500',
    defaultEndpoint: 'https://api.openai.com/v1',
    defaultModel: '',
    models: [],
    requiresApiKey: true,
    apiKeyPlaceholder: 'sk-...',
    apiKeyHelpUrl: 'https://platform.openai.com/api-keys',
    endpointEditable: true,
  },
  'azure-openai': {
    name: 'Azure OpenAI',
    icon: <Globe className="w-5 h-5" />,
    color: 'text-blue-500',
    defaultEndpoint: '',
    defaultModel: '',
    models: [],
    requiresApiKey: true,
    apiKeyPlaceholder: 'Azure API Key',
    apiKeyHelpUrl: 'https://portal.azure.com',
    endpointEditable: true,
  },
  gemini: {
    name: 'Gemini CLI',
    icon: <Activity className="w-5 h-5" />,
    color: 'text-blue-500',
    defaultModel: '',
    models: [],
    requiresApiKey: false,
    apiKeyPlaceholder: 'geminiLocalCli',
    endpointEditable: false,
  },
  custom: {
    name: 'customProvider',
    icon: <Cpu className="w-5 h-5" />,
    color: 'text-zinc-500',
    defaultEndpoint: '',
    defaultModel: '',
    models: [],
    requiresApiKey: true,
    apiKeyPlaceholder: 'apiKeyGeneric',
    endpointEditable: true,
  },
};
