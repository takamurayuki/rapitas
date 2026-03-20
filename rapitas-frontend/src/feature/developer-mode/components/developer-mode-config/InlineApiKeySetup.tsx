'use client';

/**
 * InlineApiKeySetup
 *
 * Compact API key configuration panel rendered inside the agent selector when
 * the user has agents that require an unconfigured provider.
 * Not responsible for fetching or persisting data; all I/O is delegated to props.
 */

import {
  Key,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Trash2,
  Save,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import type { ApiProvider, ApiKeyStatusMap } from './types';
import { API_KEY_PROVIDERS } from './types';

type Props = {
  /** Current map of provider → status. / プロバイダーごとの設定状況 */
  apiKeyStatuses: ApiKeyStatusMap;
  /** Currently selected provider tab. / 現在選択中のプロバイダー */
  apiKeyProvider: ApiProvider;
  onProviderChange: (provider: ApiProvider) => void;
  apiKeyInput: string;
  onApiKeyInputChange: (value: string) => void;
  showApiKey: boolean;
  onShowApiKeyToggle: () => void;
  validationError: string | null;
  successMessage: string | null;
  isSaving: boolean;
  onSave: () => void;
  onDelete: (provider: ApiProvider) => void;
};

/**
 * Renders the inline API key setup card with provider tabs, input, and status.
 *
 * @param props - Controlled values and I/O callbacks. / 制御値とI/Oコールバック
 */
export function InlineApiKeySetup({
  apiKeyStatuses,
  apiKeyProvider,
  onProviderChange,
  apiKeyInput,
  onApiKeyInputChange,
  showApiKey,
  onShowApiKeyToggle,
  validationError,
  successMessage,
  isSaving,
  onSave,
  onDelete,
}: Props) {
  const currentProvider = API_KEY_PROVIDERS.find(
    (p) => p.value === apiKeyProvider,
  )!;
  const currentStatus = apiKeyStatuses[apiKeyProvider];

  return (
    <div className="mt-3 p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 space-y-3">
      <div className="flex items-center gap-2">
        <Key className="w-3.5 h-3.5 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          APIキー設定
        </span>
        <span className="text-[10px] text-zinc-400">
          （APIが必要なモデルを有効化）
        </span>
      </div>

      {/* Provider tabs */}
      <div className="flex gap-1.5">
        {API_KEY_PROVIDERS.map((provider) => {
          const status = apiKeyStatuses[provider.value];
          const isSelected = apiKeyProvider === provider.value;
          return (
            <button
              key={provider.value}
              onClick={() => onProviderChange(provider.value)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all border ${
                isSelected
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
                  : 'border-zinc-200 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-500'
              }`}
            >
              {status.configured ? (
                <CheckCircle className="w-2.5 h-2.5 text-green-500" />
              ) : (
                <AlertCircle className="w-2.5 h-2.5 text-zinc-400" />
              )}
              {provider.label}
            </button>
          );
        })}
      </div>

      {/* Configured key display */}
      {currentStatus.configured && currentStatus.maskedKey && (
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
            <code className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 truncate">
              {currentStatus.maskedKey}
            </code>
          </div>
          <button
            onClick={() => onDelete(apiKeyProvider)}
            disabled={isSaving}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-red-500 hover:text-red-600 dark:text-red-400 transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-3 h-3" />
            削除
          </button>
        </div>
      )}

      {/* Key entry form (shown only when not yet configured) */}
      {!currentStatus.configured && (
        <div className="space-y-2">
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKeyInput}
              onChange={(e) => onApiKeyInputChange(e.target.value)}
              placeholder={currentProvider.placeholder}
              className={`w-full px-2.5 py-1.5 pr-8 bg-white dark:bg-indigo-dark-900 border rounded text-xs focus:outline-none focus:ring-2 transition-all ${
                validationError
                  ? 'border-red-400 dark:border-red-600 focus:ring-red-500/20'
                  : 'border-zinc-200 dark:border-zinc-700 focus:ring-violet-500/20 focus:border-violet-500'
              }`}
            />
            <button
              type="button"
              onClick={onShowApiKeyToggle}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              {showApiKey ? (
                <EyeOff className="w-3 h-3" />
              ) : (
                <Eye className="w-3 h-3" />
              )}
            </button>
          </div>

          {validationError && (
            <p className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              {validationError}
            </p>
          )}

          <div className="flex items-center justify-between">
            <a
              href={currentProvider.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400 hover:underline"
            >
              APIキーを取得
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
            <button
              onClick={onSave}
              disabled={!apiKeyInput.trim() || isSaving}
              className="flex items-center gap-1 px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Save className="w-3 h-3" />
              )}
              保存
            </button>
          </div>
        </div>
      )}

      {successMessage && (
        <p className="text-[10px] text-green-600 dark:text-green-400 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          {successMessage}
        </p>
      )}
    </div>
  );
}
