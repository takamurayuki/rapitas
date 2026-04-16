'use client';
// ApiKeySection

import { useTranslations } from 'next-intl';
import {
  Key,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  Trash2,
  Save,
  ChevronDown,
} from 'lucide-react';
import type { UserSettings } from '@/types';
import {
  ClaudeIcon,
  ChatGPTIcon,
  GeminiIcon,
} from '@/components/icons/ProviderIcons';
import type { ProviderState, ModelOption } from '../_hooks/useSettingsData';

type ProviderConfig = {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  consoleUrl: string;
  consoleName: string;
  configuredField: keyof UserSettings;
  modelField: keyof UserSettings;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
};

export const PROVIDERS: ProviderConfig[] = [
  {
    key: 'claude',
    label: 'claudeApiKey',
    description: 'claudeDescription',
    placeholder: 'sk-ant-api...',
    consoleUrl: 'https://console.anthropic.com/',
    consoleName: 'Anthropic Console',
    configuredField: 'claudeApiKeyConfigured',
    modelField: 'claudeDefaultModel',
    icon: ClaudeIcon,
    iconColor: 'text-orange-500',
  },
  {
    key: 'chatgpt',
    label: 'openaiApiKey',
    description: 'openaiDescription',
    placeholder: 'sk-...',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleName: 'OpenAI Platform',
    configuredField: 'chatgptApiKeyConfigured',
    modelField: 'chatgptDefaultModel',
    icon: ChatGPTIcon,
    iconColor: 'text-green-500',
  },
  {
    key: 'gemini',
    label: 'geminiApiKey',
    description: 'geminiDescription',
    placeholder: 'AIza...',
    consoleUrl: 'https://aistudio.google.com/apikey',
    consoleName: 'Google AI Studio',
    configuredField: 'geminiApiKeyConfigured',
    modelField: 'geminiDefaultModel',
    icon: GeminiIcon,
    iconColor: 'text-blue-500',
  },
];

type Props = {
  settings: UserSettings | null;
  availableModels: Record<string, ModelOption[]>;
  providerStates: Record<string, ProviderState>;
  onUpdateProviderState: (key: string, updates: Partial<ProviderState>) => void;
  onSaveApiKey: (key: string, configuredField: keyof UserSettings) => void;
  onDeleteApiKey: (key: string, configuredField: keyof UserSettings) => void;
  onSaveModel: (
    key: string,
    modelField: keyof UserSettings,
    model: string,
  ) => void;
};

/**
 * Renders all three provider API key sections.
 *
 * @param props - settings, model options, provider state, and action handlers.
 */
export function ApiKeySection({
  settings,
  availableModels,
  providerStates,
  onUpdateProviderState,
  onSaveApiKey,
  onDeleteApiKey,
  onSaveModel,
}: Props) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <Key className="w-5 h-5 text-zinc-400" />
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
            {t('apiConfig')}
          </h2>
        </div>
      </div>
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {PROVIDERS.map((provider) => {
          const state = providerStates[provider.key];
          const isConfigured = !!(settings?.[provider.configuredField] as
            | boolean
            | undefined);

          return (
            <div key={provider.key} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 ${provider.iconColor}`}
                  >
                    <provider.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                      {t(provider.label)}
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                      {t(provider.description)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isConfigured ? (
                    <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-sm font-medium">
                      <CheckCircle className="w-4 h-4" />
                      {tc('configured')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full text-sm font-medium">
                      <AlertCircle className="w-4 h-4" />
                      {tc('notConfigured')}
                    </span>
                  )}
                </div>
              </div>

              {/* Masked key display */}
              {isConfigured && state?.maskedApiKey && !state.isEditing && (
                <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">
                        {t('currentApiKey')}
                      </p>
                      <code className="block px-2 py-1 bg-zinc-200 dark:bg-zinc-700 rounded text-sm font-mono truncate">
                        {state.maskedApiKey}
                      </code>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() =>
                          onUpdateProviderState(provider.key, {
                            isEditing: true,
                          })
                        }
                        className="px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                      >
                        {tc('change')}
                      </button>
                      <button
                        onClick={() =>
                          onDeleteApiKey(provider.key, provider.configuredField)
                        }
                        disabled={state.isSaving}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        {tc('delete')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Model selector */}
              {isConfigured && availableModels[provider.key] && (
                <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                  <label
                    htmlFor={`model-${provider.key}`}
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
                  >
                    {t('defaultModel')}
                  </label>
                  <div className="relative">
                    <select
                      id={`model-${provider.key}`}
                      value={
                        (settings?.[provider.modelField] as
                          | string
                          | null
                          | undefined) ?? ''
                      }
                      onChange={(e) =>
                        onSaveModel(
                          provider.key,
                          provider.modelField,
                          e.target.value,
                        )
                      }
                      className="w-full appearance-none px-4 py-2.5 pr-10 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all text-zinc-900 dark:text-zinc-100"
                    >
                      <option value="">{tc('select')}</option>
                      {availableModels[provider.key].map((model) => (
                        <option key={model.value} value={model.value}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                  </div>
                </div>
              )}

              {/* Key input form */}
              {(!isConfigured || state?.isEditing) && (
                <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg space-y-4">
                  <div>
                    <label
                      htmlFor={`apiKey-${provider.key}`}
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
                    >
                      {t('apiKey')}
                    </label>
                    <div className="relative">
                      <input
                        type={state?.showApiKey ? 'text' : 'password'}
                        id={`apiKey-${provider.key}`}
                        value={state?.apiKeyInput ?? ''}
                        onChange={(e) =>
                          onUpdateProviderState(provider.key, {
                            apiKeyInput: e.target.value,
                          })
                        }
                        placeholder={provider.placeholder}
                        className="w-full px-4 py-2.5 pr-12 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateProviderState(provider.key, {
                            showApiKey: !state?.showApiKey,
                          })
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        {state?.showApiKey ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <a
                      href={provider.consoleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:underline"
                    >
                      {provider.consoleName} {t('getApiKey')}
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <div className="flex items-center gap-2">
                      {state?.isEditing && (
                        <button
                          onClick={() =>
                            onUpdateProviderState(provider.key, {
                              isEditing: false,
                              apiKeyInput: '',
                              showApiKey: false,
                            })
                          }
                          className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                        >
                          {tc('cancel')}
                        </button>
                      )}
                      <button
                        onClick={() =>
                          onSaveApiKey(provider.key, provider.configuredField)
                        }
                        disabled={!state?.apiKeyInput.trim() || state?.isSaving}
                        className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {state?.isSaving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        {tc('save')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
