'use client';
// DefaultProviderSection

import { useTranslations } from 'next-intl';
import { Settings, CheckCircle } from 'lucide-react';
import type { UserSettings, ApiProvider } from '@/types';
import { PROVIDERS } from './ApiKeySection';

const PROVIDER_LABELS: Record<ApiProvider, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  ollama: 'Ollama',
};

const PROVIDER_DESCRIPTIONS: Record<ApiProvider, string> = {
  claude: 'Anthropic Claude API',
  chatgpt: 'OpenAI ChatGPT / GPT API',
  gemini: 'Google Gemini API',
  ollama: 'Local LLM (Ollama / llama-server)',
};

type Props = {
  settings: UserSettings | null;
  onSaveDefaultProvider: (provider: ApiProvider) => void;
};

/**
 * Grid of provider cards for selecting the default AI provider.
 *
 * @param props - settings and save handler.
 */
export function DefaultProviderSection({
  settings,
  onSaveDefaultProvider,
}: Props) {
  const t = useTranslations('settings');

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-zinc-400" />
          <div>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
              {t('defaultAiProvider')}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              {t('selectDefaultAi')}
            </p>
          </div>
        </div>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(['claude', 'chatgpt', 'gemini'] as ApiProvider[]).map((p) => {
            const provider = PROVIDERS.find((pr) => pr.key === p);
            const configField = provider?.configuredField;
            const isConfigured = !!(
              configField && settings?.[configField as keyof UserSettings]
            );
            const isSelected = settings?.defaultAiProvider === p;

            return (
              <button
                key={p}
                onClick={() => {
                  if (isConfigured) onSaveDefaultProvider(p);
                }}
                disabled={!isConfigured}
                className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                  isSelected
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                    : isConfigured
                      ? 'border-zinc-200 dark:border-zinc-700 hover:border-violet-300 dark:hover:border-violet-700 bg-white dark:bg-zinc-800'
                      : 'border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 opacity-50 cursor-not-allowed'
                }`}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2">
                    <CheckCircle className="w-5 h-5 text-violet-500" />
                  </div>
                )}
                <div className="flex items-start gap-2">
                  {provider && (
                    <div
                      className={`p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 ${provider.iconColor}`}
                    >
                      <provider.icon className="w-4 h-4" />
                    </div>
                  )}
                  <div>
                    <h3
                      className={`font-medium text-sm ${
                        isSelected
                          ? 'text-violet-700 dark:text-violet-300'
                          : isConfigured
                            ? 'text-zinc-900 dark:text-zinc-100'
                            : 'text-zinc-400 dark:text-zinc-600'
                      }`}
                    >
                      {PROVIDER_LABELS[p]}
                    </h3>
                    <p
                      className={`text-xs mt-1 ${
                        isSelected
                          ? 'text-violet-500 dark:text-violet-400'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {PROVIDER_DESCRIPTIONS[p]}
                    </p>
                    {!isConfigured && (
                      <p className="text-xs text-amber-500 mt-2">
                        {t('apiKeyNotConfigured')}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
