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
import { type Bot, Terminal, Zap, Activity, Search, Play, Shield, Scale } from 'lucide-react';

export type TabId = 'task-analysis' | 'agent-execution';

export type ModalProps = {
  config: DeveloperModeConfig | null;
  isOpen: boolean;
  onCloseAction: () => void;
  onSaveAction: (updates: Partial<DeveloperModeConfig>) => Promise<DeveloperModeConfig | null>;
  selectedAgentConfigId?: number | null;
  onAgentConfigChangeAction?: (agentConfigId: number | null) => void;
  taskId?: number;
};

export type ApiKeyStatusMap = Record<ApiProvider, ApiKeyStatus>;

// NOTE: labels are resolved via translation at render time (see labelKey).
// `devMode.agentTypeInfo` — same product names in ja/en, so translation is a
// no-op today, but callers stay consistent with the rest of this file.
export const AGENT_TYPE_INFO: Record<
  string,
  { icon: typeof Bot; color: string; labelKey: string }
> = {
  'claude-code': {
    icon: Terminal,
    color: 'text-orange-500',
    labelKey: 'claudeCode',
  },
  codex: { icon: Zap, color: 'text-green-500', labelKey: 'codex' },
  gemini: { icon: Activity, color: 'text-indigo-500', labelKey: 'gemini' },
};

// labelKey resolved via devMode.developerModeConfigModal's `t` (e.g. t('tabs.taskAnalysis')).
export const TABS: { id: TabId; labelKey: string; icon: typeof Search }[] = [
  { id: 'task-analysis', labelKey: 'tabs.taskAnalysis', icon: Search },
  { id: 'agent-execution', labelKey: 'tabs.agentExecution', icon: Play },
];

// labelKey/descriptionKey resolved via devMode.taskAnalysisTab's `t`.
export const PRIORITY_OPTIONS = [
  {
    value: 'conservative' as const,
    labelKey: 'priorityOptions.conservative.label',
    icon: Shield,
    descriptionKey: 'priorityOptions.conservative.description',
  },
  {
    value: 'balanced' as const,
    labelKey: 'priorityOptions.balanced.label',
    icon: Scale,
    descriptionKey: 'priorityOptions.balanced.description',
  },
  {
    value: 'aggressive' as const,
    labelKey: 'priorityOptions.aggressive.label',
    icon: Zap,
    descriptionKey: 'priorityOptions.aggressive.description',
  },
];

// labelKey resolved via devMode.apiKeyProviders' `t` (product names — same in ja/en).
export const API_KEY_PROVIDERS: {
  value: ApiProvider;
  labelKey: string;
  placeholder: string;
  link: string;
}[] = [
  {
    value: 'claude',
    labelKey: 'claude',
    placeholder: 'sk-ant-api...',
    link: 'https://console.anthropic.com/',
  },
  {
    value: 'chatgpt',
    labelKey: 'chatgpt',
    placeholder: 'sk-proj-...',
    link: 'https://platform.openai.com/api-keys',
  },
  {
    value: 'gemini',
    labelKey: 'gemini',
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
