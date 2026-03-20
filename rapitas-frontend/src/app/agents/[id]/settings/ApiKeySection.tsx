/**
 * ApiKeySection
 *
 * Displays current API key status, a new-key input with visibility toggle,
 * a delete button, a help link, and an encryption notice.
 */

'use client';

import {
  Key,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Trash2,
  Info,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AgentConfig } from './agentSettingsTypes';
import type { ProviderConfig } from './providerConfigs';

type Props = {
  agent: AgentConfig;
  providerConfig: ProviderConfig;
  apiKey: string;
  showApiKey: boolean;
  fieldErrors: Record<string, string | null>;
  onApiKeyChange: (v: string) => void;
  onToggleShow: () => void;
  onDeleteApiKey: () => void;
};

/**
 * Renders the API key management section, or returns null if the provider
 * does not require an API key.
 *
 * @param props - ApiKeySection props
 */
export function ApiKeySection({
  agent,
  providerConfig,
  apiKey,
  showApiKey,
  fieldErrors,
  onApiKeyChange,
  onToggleShow,
  onDeleteApiKey,
}: Props) {
  const t = useTranslations('agents');

  if (!providerConfig.requiresApiKey) return null;

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 mb-6">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
        <Key className="w-5 h-5" />
        {t('apiKeyTitle')}
      </h2>

      {/* Current API Key Status */}
      <div className="mb-4 p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {agent.hasApiKey ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-sm text-green-600 dark:text-green-400">
                  {t('apiKeyConfigured')}
                </span>
                {agent.maskedApiKey && (
                  <code className="text-xs bg-zinc-200 dark:bg-zinc-600 px-2 py-1 rounded">
                    {agent.maskedApiKey}
                  </code>
                )}
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 text-zinc-400" />
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t('apiKeyNotConfigured')}
                </span>
              </>
            )}
          </div>
          {agent.hasApiKey && (
            <button
              onClick={onDeleteApiKey}
              className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 p-1 rounded"
              title={t('deleteApiKey')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* New API Key Input */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {agent.hasApiKey ? t('newApiKey') : t('apiKeyTitle')}
        </label>
        <div className="relative">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            className={`w-full px-3 py-2 pr-10 border rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:border-transparent ${
              fieldErrors.apiKey
                ? 'border-red-400 dark:border-red-600 focus:ring-red-500'
                : 'border-zinc-300 dark:border-zinc-600 focus:ring-indigo-500'
            }`}
            placeholder={
              [
                'claudeCodeLocalCli',
                'codexLocalCli',
                'geminiLocalCli',
                'apiKeyGeneric',
              ].includes(providerConfig.apiKeyPlaceholder)
                ? t(providerConfig.apiKeyPlaceholder as 'claudeCodeLocalCli')
                : providerConfig.apiKeyPlaceholder
            }
          />
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {showApiKey ? (
              <EyeOff className="w-5 h-5" />
            ) : (
              <Eye className="w-5 h-5" />
            )}
          </button>
        </div>
        {fieldErrors.apiKey && (
          <p className="text-xs text-red-500 dark:text-red-400 mt-1">
            {fieldErrors.apiKey}
          </p>
        )}
        {!fieldErrors.apiKey && providerConfig.apiKeyHelpUrl && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            <a
              href={providerConfig.apiKeyHelpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {t('howToGetApiKey')}
            </a>
          </p>
        )}
      </div>

      {/* Security Info */}
      <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex gap-2">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-600 dark:text-blue-400">
            {t('apiKeyEncryptionInfo')}
          </p>
        </div>
      </div>
    </div>
  );
}
