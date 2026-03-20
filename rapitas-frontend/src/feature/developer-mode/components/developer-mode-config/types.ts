/**
 * DeveloperModeConfig — shared types and constants for the config modal sub-components.
 *
 * Not responsible for any rendering logic; purely structural definitions used
 * across the split sub-components.
 */

import type {
  DeveloperModeConfig,
  AIAgentConfig,
  AnalysisDepth,
  PriorityStrategy,
  PromptStrategy,
  BranchStrategy,
  ReviewScope,
  ApiProvider,
  ApiKeyStatus,
} from '@/types';
import { Bot, Terminal, Zap, Activity, Search, Play, Shield, Scale } from 'lucide-react';

export type TabId = 'task-analysis' | 'agent-execution';

export type ModalProps = {
  config: DeveloperModeConfig | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    updates: Partial<DeveloperModeConfig>,
  ) => Promise<DeveloperModeConfig | null>;
  selectedAgentConfigId?: number | null;
  onAgentConfigChange?: (agentConfigId: number | null) => void;
  taskId?: number;
};

export type ApiKeyStatusMap = Record<ApiProvider, ApiKeyStatus>;

export const AGENT_TYPE_INFO: Record<
  string,
  { icon: typeof Bot; color: string; label: string }
> = {
  'claude-code': {
    icon: Terminal,
    color: 'text-orange-500',
    label: 'Claude Code',
  },
  codex: { icon: Zap, color: 'text-green-500', label: 'Codex CLI' },
  gemini: { icon: Activity, color: 'text-blue-500', label: 'Gemini CLI' },
};

export const TABS: { id: TabId; label: string; icon: typeof Search }[] = [
  { id: 'task-analysis', label: 'タスク分析', icon: Search },
  { id: 'agent-execution', label: 'エージェント実行', icon: Play },
];

export const PRIORITY_OPTIONS = [
  {
    value: 'conservative' as const,
    label: '慎重',
    icon: Shield,
    description: '少数の大きなサブタスクに分解',
  },
  {
    value: 'balanced' as const,
    label: 'バランス',
    icon: Scale,
    description: '適度な粒度で分解（推奨）',
  },
  {
    value: 'aggressive' as const,
    label: '詳細',
    icon: Zap,
    description: '細かいサブタスクに詳細分解',
  },
];

export const API_KEY_PROVIDERS: {
  value: ApiProvider;
  label: string;
  placeholder: string;
  link: string;
}[] = [
  {
    value: 'claude',
    label: 'Claude (Anthropic)',
    placeholder: 'sk-ant-api...',
    link: 'https://console.anthropic.com/',
  },
  {
    value: 'chatgpt',
    label: 'ChatGPT (OpenAI)',
    placeholder: 'sk-proj-...',
    link: 'https://platform.openai.com/api-keys',
  },
  {
    value: 'gemini',
    label: 'Gemini (Google)',
    placeholder: 'AIza...',
    link: 'https://aistudio.google.com/apikey',
  },
];

// CLI-based agent types that do not require API keys.
export const CLI_AGENT_TYPES = ['claude-code', 'codex', 'gemini'];

// Mapping of API providers to the agent types they unlock.
export const PROVIDER_TO_AGENT_TYPES: Record<ApiProvider, string[]> = {
  claude: ['anthropic-api'],
  chatgpt: ['openai', 'azure-openai'],
  gemini: ['gemini'],
  ollama: ['ollama'],
};

// Re-export types used by sub-components so they only need one import.
export type {
  AIAgentConfig,
  AnalysisDepth,
  PriorityStrategy,
  PromptStrategy,
  BranchStrategy,
  ReviewScope,
  ApiProvider,
  ApiKeyStatus,
};
